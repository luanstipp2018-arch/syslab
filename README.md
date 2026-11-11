# SysLab

Projeto acadêmico para gestão dos laboratórios da UNIFEV, desenvolvido com Node.js, JavaScript e MySQL.

## Funcionalidades

- **Usuários** — cadastro por RA e perfil, com definição de senha por link de primeiro acesso.
- **Agendamentos** — solicitação por alunos e professores, com aprovação pelo responsável ou pela TI. O professor tem prioridade sobre reservas de alunos no mesmo horário.
- **Estoque** — registro de entradas e saídas, com bloqueio de retiradas acima do saldo disponível.

Contas, reservas e estoque são armazenados no banco de dados. Equipamentos, manutenções e auditoria usam dados de demonstração no navegador.

## Execução local

Requer Node.js 24 ou superior e um banco MySQL ou MariaDB criado. O usuário do banco deve ter permissão para criar tabelas.

1. Instale as dependências com `npm ci`.
2. Copie `.env.example` para `.env` e preencha os dados do banco.
3. Execute `npm run admin:gerar` e copie o valor gerado de `ADMIN_PASSWORD_HASH` para o `.env`.
4. Execute `npm start` e acesse [localhost:3000](http://localhost:3000). Em um banco novo, entre com o usuário `admin` e a senha gerada.
