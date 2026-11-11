const capacity = {ELE:48,HW1:36,HW2:36,BIT:20};
const slots = ['M1','M2','T1','T2','N1','N2'];
const purposes = ['aula','reposicao','prova','tcc','projeto'];
const active = ['pendente','aprovada'];
const dateFormat = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const today = () => dateFormat.format(new Date());
const readJSON = value => typeof value === 'string' ? JSON.parse(value) : value;
const canReview = user => ['ti','resp'].includes(user.role);
const textField = (data,key) => (data.get(key) || '').trim();
const event = (user,acao,texto='',k='info') => ({autor:user.name,acao,texto,k,em:new Date().toISOString()});

async function query(db,sql,...args) {
  const [result] = await db.execute(sql,args);
  return result;
}

export async function reservationList(db,user) {
  const result = await query(db,`SELECT r.*,u.name AS requester FROM reservations r
    JOIN users u ON u.email=r.owner ORDER BY r.id`);
  return result.filter(r=>canReview(user)||r.owner===user.email||active.includes(r.status)).map(r=>{
    const own = r.owner===user.email;
    const visible = own||canReview(user);
    return {
      ...(visible ? readJSON(r.details) : {fin:'aula',disciplina:'',alunos:0,hw:[]}),
      id:'R-'+r.id, userId:own ? (r.requester_role==='aluno'?'aluno':'ricardo') : 'solicitante',
      nome:visible?r.requester:'Horário solicitado', lab:r.lab, data:r.day, slot:r.slot,
      status:r.status, criada:r.created, hist:visible?readJSON(r.history):[],
      motivo:visible?(readJSON(r.history).at(-1)?.texto || ''):'',
      email:false, own, privateDetails:visible, requesterRole:r.requester_role,
    };
  });
}

function reject(message,status=409) {
  const error = new Error(message);
  error.status=status;
  throw error;
}

async function createReservation(db,user,data) {
  const role = user.role==='ti'?data.get('view'):user.role;
  if(!['aluno','professor'].includes(role))reject('Seu perfil não pode solicitar reservas.',403);
  const lab=data.get('lab'), day=data.get('data'), slot=data.get('slot'), fin=data.get('fin');
  const alunos=Number(data.get('alunos'));
  const date=new Date(day+'T12:00:00Z');
  const minimum=new Date(today()+'T12:00:00Z');
  const details={fin,alunos,hw:[]};
  for(const key of ['disciplina','tccAlunos','materiais','roteiro','obs'])details[key]=textField(data,key);
  if(!Object.hasOwn(capacity,lab)||!slots.includes(slot)||!purposes.includes(fin)||
    !Number.isInteger(alunos)||alunos<1||alunos>capacity[lab]||!details.disciplina||
    Object.values(details).some(value=>typeof value==='string'&&value.length>1000)||
    (fin==='tcc'&&!details.tccAlunos)||!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||
    !Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day||date<minimum||
    date.getUTCDay()===0||(date.getUTCDay()===6&&!details.obs)){
    reject('Confira a data, o horário e os dados da reserva.',400);
  }
  try { details.hw=JSON.parse(data.get('hw') || '[]'); } catch { reject('Equipamentos inválidos.',400); }
  if(!Array.isArray(details.hw)||details.hw.length>50||
    details.hw.some(id=>typeof id!=='string'||!/^EQ-\d{1,10}$/.test(id)))reject('Equipamentos inválidos.',400);
  const current=await query(db,"SELECT owner,requester_role,status FROM reservations WHERE lab=? AND day=? AND slot=? AND status IN ('pendente','aprovada')",lab,day,slot);
  if(current.some(r=>r.status==='aprovada'&&(role!=='professor'||r.requester_role!=='aluno')))reject('Este horário já foi reservado.');
  if(current.some(r=>r.owner===user.email))reject('Você já tem um pedido neste horário.');
  if(role==='aluno'){
    const [count]=await query(db,"SELECT COUNT(*) AS total FROM reservations WHERE owner=? AND requester_role='aluno' AND status IN ('pendente','aprovada') AND day>=?",user.email,today());
    if(count.total>=2)reject('Você já tem duas reservas ativas ou pendentes.');
  }
  const initial=event(user,'Solicitação enviada');
  const result=await query(db,`INSERT INTO reservations(owner,requester_role,lab,day,slot,details,history,created)
    VALUES (?,?,?,?,?,?,?,?)`,user.email,role,lab,day,slot,JSON.stringify(details),JSON.stringify([initial]),initial.em);
  return {id:'R-'+result.insertId};
}

async function setStatus(db,user,row,status,reason) {
  const labels={aprovada:'Aprovada',recusada:'Recusada',cancelada:'Cancelada'};
  const history=[...readJSON(row.history),event(user,labels[status],reason,status==='aprovada'?'ok':'bad')];
  await query(db,'UPDATE reservations SET status=?,history=? WHERE id=?',status,JSON.stringify(history),row.id);
}

async function decide(db,user,data) {
  const action=data.get('action'), code=data.get('id')||'', reason=textField(data,'reason');
  if(!/^R-\d{1,10}$/.test(code)||!['approve','decline','cancel'].includes(action)||reason.length>1000)reject('Solicitação inválida.',400);
  const [row]=await query(db,'SELECT * FROM reservations WHERE id=?',Number(code.slice(2)));
  if(!row)reject('Reserva indisponível.',404);
  if(action==='cancel'){
    if(row.owner!==user.email&&!canReview(user))reject('Acesso restrito.',403);
    if(!active.includes(row.status)||row.day<today()||!reason)reject('Informe a justificativa para cancelar uma reserva vigente.');
    await setStatus(db,user,row,'cancelada',reason);
    return {id:code};
  }
  if(!canReview(user))reject('Acesso restrito.',403);
  if(row.status!=='pendente')reject('Este pedido já foi analisado.');
  if(action==='decline'){
    if(!reason)reject('Informe a justificativa.');
    await setStatus(db,user,row,'recusada',reason);
    return {id:code};
  }
  if(row.day<today())reject('A data desta reserva já passou.');
  const conflicts=await query(db,`SELECT * FROM reservations WHERE lab=? AND day=? AND slot=? AND id<>?
    AND status IN ('pendente','aprovada')`,row.lab,row.day,row.slot,row.id);
  const hasPriority=other=>row.requester_role==='professor'&&other.requester_role==='aluno';
  if(conflicts.some(r=>r.status==='aprovada'&&!hasPriority(r)))reject('O horário já foi reservado.');
  if(row.requester_role==='aluno'&&conflicts.some(r=>r.requester_role==='professor'&&r.status==='pendente')){
    reject('Há uma solicitação de professor com prioridade neste horário.');
  }
  if(conflicts.length&&!reason)reject('Há pedidos concorrentes. Informe uma justificativa para resolver o conflito.');
  for(const other of conflicts){
    const approved=other.status==='aprovada';
    await setStatus(db,user,other,approved?'cancelada':'recusada',
      approved?'Reserva substituída por prioridade docente. '+reason:reason);
  }
  await setStatus(db,user,row,'aprovada','');
  return {id:code};
}

export async function changeReservation(db,user,path,data) {
  if(!user)reject('Entre novamente.',401);
  await db.beginTransaction();
  try {
    // Serialize changes so parallel requests cannot bypass limits or approve the same slot.
    await query(db,'SELECT id FROM reservation_lock WHERE id=1 FOR UPDATE');
    const result=path==='/reservas/solicitar'?await createReservation(db,user,data):await decide(db,user,data);
    await db.commit();
    return result;
  } catch(error) {
    await db.rollback();
    throw error;
  }
}
