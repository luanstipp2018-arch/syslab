# SysLab UNIFEV

Portal de gestão dos laboratórios da UNIFEV. O administrador cadastra usuários
por nome, e-mail, RA e perfil. Cada pessoa define a própria senha por um link
de primeiro acesso de uso único, válido por 48 horas.

## Executar localmente

Pré-requisitos: Node.js 24 ou superior e um banco MySQL ou MariaDB com um
usuário dedicado. O aplicativo cria as tabelas de schema.sql na primeira
execução. Conceda permissão de criação de tabelas ao usuário do banco.

1. Execute `npm ci`.
2. Copie `.env.example` para `.env` e preencha os dados do banco.
3. Execute `npm run admin:gerar`. Guarde a senha em um gerenciador de senhas e
   copie apenas o valor de `ADMIN_PASSWORD_HASH` para o arquivo `.env`.
4. Execute `npm start` e acesse http://localhost:3000. Entre com o usuário
   `admin` e a senha gerada.
5. Em **Usuários**, cadastre uma conta e entregue o link de primeiro acesso
   diretamente à pessoa.

O hash inicial é usado ao criar a credencial de `admin` em um banco novo.
Alterar a variável depois da criação não troca a senha de uma conta existente.

## Publicar na Hostinger

Configure o aplicativo Node.js com `server.mjs` como arquivo de entrada.
No hPanel, configure as variáveis de `.env.example` com os valores reais da
hospedagem. Use a URL pública HTTPS em `APP_URL` e a porta atribuída pelo
provedor. Mantenha senhas e hashes nas variáveis de ambiente do servidor.

## Estrutura

- `server.mjs` — autenticação, gerenciamento de usuários, primeiro acesso e estoque.
- `portal.html` — interface do portal e telas de cada perfil.
- `assets/` — estilos do portal, login, cadastro e mensagens do sistema.
- `schema.sql` — tabelas MySQL.
- `scripts/generate-admin-password.mjs` — geração local da credencial inicial.

O MySQL armazena contas, sessões, materiais, movimentações de estoque e reservas.
Equipamentos, manutenções e auditoria do protótipo ficam no
navegador. Esses módulos operam com dados de demonstração.

Execute `npm run check` para validar a sintaxe do servidor.
