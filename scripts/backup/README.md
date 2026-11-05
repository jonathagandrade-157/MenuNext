# Scripts de backup e restauração

Backup **lógico e criptografado** do banco PostgreSQL (Supabase) e dos arquivos do Storage (`restaurant-assets`), com
manifesto de integridade, retenção e verificação de frescor. Não depende de nada além de Node 20+, `gpg` e `tar`
(mais `pg_dump`/`pg_restore` 17+ para o banco).

> **Estado de validação (leia primeiro).**
> - **Aprovado em laboratório, com ferramentas REAIS:** `pg_dump`/`pg_restore` 17.6, GnuPG e `tar`, sobre um PostgreSQL 17 descartável com as 63 migrations e dados sintéticos: backup, criptografia com chave protegida por frase-senha, conferência SHA-256, restauração em banco novo, comparação de **todas as tabelas (contagem e hash do conteúdo), funções, políticas, GRANTs, gatilhos, índices e restrições** com a origem (idênticos), suítes SQL de segurança passando sobre o banco restaurado, simulação de perda de dados com recuperação, dump truncado/arquivo adulterado/senha errada/banco fora do ar detectados, retenção com 30 backups reais. Roteiro e resultado do exercício: seção "Exercício de restauração".
> - **NÃO aprovado:** (1) restauração a partir do **Supabase real** (os esquemas gerenciados `auth`/`storage` têm donos e extensões próprios; só se prova com um projeto de teste do Supabase); (2) a **API real do Supabase Storage** (o laboratório usa um servidor que só imita listar/baixar); (3) automação agendada em produção; (4) tempo de restauração com o volume real (o do laboratório tem dezenas de KB).
> - `backup.test.mjs` (43 verificações) roda no CI/local com `pg_dump`/`pg_restore`/`psql` **simulados**; só os exercícios de laboratório usam as ferramentas reais.
> - **Sem Docker/WSL:** este computador não roda Docker. O `gate-check.mjs --sem-docker` aprova só o que se prova com PostgreSQL 17 **nativo**; Auth, Storage e Realtime reais continuam **NÃO VERIFICADOS** (lista no próprio relatório do portão).

## O que cada script faz

| Script | Função |
|---|---|
| `backup-db.mjs` | `pg_dump` (formato custom, **com** GRANTs) dos esquemas `public`, `auth`, `storage` → **auto-verifica o dump (`pg_restore --list`) antes de cifrar** → criptografa com a chave **pública** do dono → apaga o texto claro → grava `*.manifest.json` (SHA-256, tamanho, data) → aplica a retenção |
| `backup-storage.mjs` | lista e baixa todos os objetos do bucket (ignora nomes perigosos, como `../`), gera `tar.gz`, criptografa, grava manifesto, aplica retenção |
| `verify-backup.mjs` | (1) integridade pelo manifesto, sem chave privada; (2) frescor: alerta se o último backup está velho; (3) restauração: decifra, confere o conteúdo (`pg_restore --list`) e, opcionalmente, restaura em banco **local** descartável (`--clean --if-exists`: o dump recria o esquema `public`) |
| `restore-storage.mjs` | reenvia os arquivos do backup do Storage para um Storage de TESTE (ou local) e confere lista + SHA-256 de cada objeto; recusa produção (`BACKUP_PROTECTED_REFS`) e exige `--allow-remote-ref <ref>` para qualquer projeto remoto |
| `post-restore.sql` | passos obrigatórios depois do `pg_restore`: o dump filtrado por esquema NÃO leva a publicação `supabase_realtime`; sem recolocar `public.orders` nela o Kanban/KDS para de atualizar sozinho (o `verify-backup.mjs --restore-url` já roda este arquivo com `psql`) |
| `fingerprint.sql` | impressão estrutural (funções, políticas, RLS, GRANTs, gatilhos, índices, restrições) para comparar origem × restaurado, sem dado pessoal |
| `mask-restored.sql` | pseudonimiza uma CÓPIA restaurada (nomes, telefones, e-mails, documentos, endereços, chaves Pix, senhas) para conferir tudo sem ver dado pessoal; recusa rodar sem confirmação explícita |
| `gpg-keys.mjs` | gera as **duas** chaves GPG (principal e emergência) num chaveiro dedicado, exporta para guarda offline e **prova a recuperação de cada chave sozinha** em chaveiro isolado e vazio (dados sintéticos, hash antes/depois); grava a evidência que o portão (item 3) lê. Nunca vê frase-senha (usa o pinentry do Windows) e nunca apaga chave |
| `source-role-probe.sql` | sonda SOMENTE LEITURA que o `backup-db.mjs` roda **antes** do `pg_dump`: o papel da origem precisa ser de privilégio mínimo (sem superusuário, sem DDL, sem INSERT/UPDATE/DELETE em nenhuma tabela dos esquemas copiados); papel privilegiado só passa com `BACKUP_ACCEPT_PRIVILEGED_SOURCE=sim-aceito-pelo-dono` |
| `create-backup-role.sql` | cria o papel `backup_ro` (leitura de tudo, nada de escrita, sessão somente leitura no servidor). **Não executado em produção**: exige autorização expressa |
| `sync-external.mjs` | copia os `.gpg` + manifestos para o **disco externo** (confere SHA-256 antes e depois, nunca sobrescreve, recusa o mesmo volume, aplica a retenção) |
| `sync-r2.mjs` | envio ao **Cloudflare R2** via `rclone` (`--immutable`, manifesto por último, confere o tamanho remoto). Sem `--executar` só mostra o plano. **Nunca executado contra um R2 real** |
| `lib.mjs` | funções comuns (retenção, manifesto, criptografia, recusa de destino remoto, ocultação de segredos) |
| `github-actions.example.yml` | **exemplo** de agendamento (não está em `.github/`, portanto não roda sozinho) |

## Variáveis de ambiente (nunca em argumento de linha de comando)

| Variável | Uso |
|---|---|
| `DATABASE_URL` | conexão do banco para o `pg_dump`; o papel esperado é `backup_ro` (a sonda recusa um papel com mais privilégio) |
| `BACKUP_ACCEPT_PRIVILEGED_SOURCE` | (exceção) `sim-aceito-pelo-dono` permite uma origem com mais privilégio que o mínimo; fica registrado no manifesto |
| `BACKUP_EXTERNAL_DIR` | pasta do disco externo (BitLocker) usada por `sync-external.mjs` |
| `R2_BUCKET`, `R2_PREFIX`, `RCLONE_CONFIG_R2_*` | destino R2 usado por `sync-r2.mjs` (credenciais só no ambiente do processo) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | backup do Storage (a chave de servidor só existe no executor do backup) |
| `BACKUP_DIR` | pasta de saída (padrão `./backups`, ignorada pelo Git) |
| `BACKUP_GPG_RECIPIENT` | impressões digitais (ou e-mails) das chaves **públicas**, separadas por vírgula: principal e emergência |
| `BACKUP_GPG_HOME` | chaveiro dedicado do backup (padrão do `gpg-keys.mjs`: `~/.menunext-backup-gnupg`); usado por `backup-db.mjs` e `backup-storage.mjs` |
| `GPG_BIN_DIR` | (opcional) pasta do `gpg.exe`; no Windows o gpg do Git (pasta `usr/bin` dele) é localizado sozinho quando não está no PATH |
| `BACKUP_SCHEMAS` | padrão `public,auth,storage` |
| `BACKUP_EXCLUDE_DATA` | (opcional) tabelas cujo CONTEÚDO fica fora do dump, separadas por vírgula (a estrutura entra). Sugestão para o Supabase: `auth.sessions,auth.refresh_tokens,auth.flow_state,auth.one_time_tokens,auth.audit_log_entries` (sem valor de recuperação e sensíveis) |
| `BACKUP_HEARTBEAT_URL` | (opcional) URL de monitor externo; recebe `/fail` quando o backup falha |
| `PG_DUMP_CMD`, `PG_RESTORE_CMD`, `PSQL_CMD` | (opcional) caminho do `pg_dump`/`pg_restore`/`psql` 17+. No Windows use aspas se o caminho tiver espaço: `"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"`. Sem `PSQL_CMD`, o `psql` é procurado ao lado do `pg_dump` |

A senha do banco é convertida em variáveis `PG*` só para o processo filho, para **não aparecer** na lista de processos.
Mensagens de erro passam por `redact()` (senhas de URL, `Bearer`, `token=`).

## Criptografia e guarda das chaves

- O executor do backup só conhece a **chave pública** (`gpg --import chave-publica.asc`). Quem roda o backup **não
  consegue ler** o que gerou.
- A **chave privada** fica fora do executor e fora do Git: gerenciador de senhas/cofre do dono e uma cópia offline
  separada. **Sem ela os backups são irrecuperáveis**; guarde-a em dois lugares independentes.
- Guarde a **frase-senha da chave** separada da própria chave.
- O que nunca entra no Git (`.gitignore`): `backups/`, `*.gpg`, `*.dump`, `*.asc`, `.gnupg/`. Há teste automatizado
  (`gitignore protege backups e chaves`) que falha se isso mudar.

```bash
# uma vez, em máquina do dono: gera o par de chaves e exporta SÓ a pública para o executor
gpg --quick-generate-key "backup@seu-dominio.com.br" rsa4096 encr 2y
gpg --export --armor backup@seu-dominio.com.br > chave-publica.asc    # esta pode ir para o executor
gpg --export-secret-keys --armor backup@seu-dominio.com.br > chave-privada.asc   # NUNCA no executor nem no Git
```

## Armazenamento externo

Os arquivos `.gpg` já são ilegíveis sem a chave privada, então podem ir para um armazenamento de objetos comum. Regras:
- **Fora** do provedor do banco e fora da conta que roda o backup (uma conta comprometida não pode apagar tudo);
- ativar **versionamento / bloqueio de objeto** (WORM) quando o provedor oferecer;
- credencial de envio **só de escrita**; credencial de leitura/restauração separada e guardada pelo dono.

Opções comuns (valores de **referência** a confirmar nas tabelas oficiais na hora de contratar): Backblaze B2, Cloudflare R2,
AWS S3 (classe infrequente) ou um disco externo offline atualizado semanalmente. Para o volume atual (dezenas de MB) o
custo de armazenamento é desprezível; o custo relevante é o do plano do banco (abaixo).

## Retenção e rotação

Política padrão (`selectRetention`): **7 diários + 4 semanais + 6 mensais**, sempre mantendo o mais recente; nomes sem
data válida nunca são apagados. Arquivo e manifesto saem juntos. Ajustável por parâmetro. A rotação roda ao final de cada
backup, na pasta local; aplique a mesma regra no armazenamento externo (ciclo de vida do bucket).

## Monitoramento e alertas

1. `BACKUP_HEARTBEAT_URL` (healthchecks.io ou equivalente): sucesso → ping; falha → `/fail`; **ausência de ping** também alerta.
2. `node scripts/backup/verify-backup.mjs --dir backups --freshness 26` (retorna código 2 se o último backup de banco ou de
   Storage tem mais de 26 h) — rode em agendamento separado do backup.
3. `node scripts/backup/verify-backup.mjs --dir backups --manifest <arquivo>.manifest.json` confere SHA-256 sem precisar da chave privada.

## RPO e RTO propostos (a aprovar pelo proprietário)

| Cenário | RPO (perda máxima de dados) | RTO (tempo para voltar) | Como |
|---|---|---|---|
| Mínimo viável | até 24 h | até 4 h | dump lógico diário (estes scripts) |
| Recomendado para beta | até 24 h + cópia do provedor | até 2 h | scripts + backup diário do plano pago do banco |
| Pedidos reais em volume | minutos | menos de 1 h | plano pago com recuperação em ponto no tempo (PITR) + scripts como cópia independente |

O RTO só é real depois de **um exercício de restauração cronometrado**. Faça um antes do beta e repita a cada trimestre.

## Restauração (exercício e emergência)

Sempre **primeiro em banco descartável local**; restaurar em produção é decisão manual do dono, fora destes scripts
(`verify-backup.mjs` **recusa** qualquer destino que não seja `localhost`).

```bash
# 1) integridade (qualquer máquina, sem chave privada)
node scripts/backup/verify-backup.mjs --dir backups --manifest menunext-db-AAAAMMDDTHHMMSSZ.dump.gpg.manifest.json

# 2) decifrar + conferir conteúdo (máquina do dono, com a chave privada)
node scripts/backup/verify-backup.mjs --dir backups --manifest <manifesto> --decrypt

# 3) restaurar num PostgreSQL 17 LOCAL vazio (banco descartável)
node scripts/backup/verify-backup.mjs --dir backups --manifest <manifesto> --decrypt \
  --restore-url postgres://postgres:senha-local@127.0.0.1:5432/restore_test

# 4) conferir: contagens de tabelas e as suítes SQL de isolamento (supabase/tests/*.sql) sobre o banco restaurado
```

Limitações conhecidas da restauração lógica: **não** inclui senhas/sessões do `auth` além do que o `pg_dump` do esquema
`auth` entrega (testar com cuidado), não restaura funções/papéis internos do Supabase, e os objetos do Storage são
restaurados como arquivos (reenviar ao bucket é um passo manual). Registre no exercício o que foi e o que não foi
recuperado.

## Exercício de restauração (como repetir)

Pré-requisitos: PostgreSQL 17 (cliente `pg_dump`/`pg_restore` 17+), `gpg`, `tar`, Node 20+. No Windows, o pacote oficial de binários
(`postgresql-17.x-windows-x64-binaries.zip`, página de download do PostgreSQL → EDB) traz o cliente; ele **não vem assinado**: anote o SHA-256
do arquivo baixado e a versão (`pg_dump --version`). O servidor do exercício tem de ser **local** (o script recusa outro destino).

1. Crie um banco descartável com os dados sintéticos e rode `backup-db.mjs` apontando para ele (`PG_DUMP_CMD`, `PG_RESTORE_CMD`).
2. `verify-backup.mjs --manifest <manifesto> --decrypt --restore-url postgres://…@127.0.0.1:<porta>/restaurado`.
3. Compare origem × restaurado: contagem e hash por tabela; `pg_get_functiondef`, políticas, GRANTs, gatilhos, índices e restrições
   (o texto de um CHECK pode voltar com parênteses diferentes: compare sem parênteses).
4. Rode as suítes SQL de segurança (`supabase/tests/*.sql`) sobre o banco restaurado.
5. Simule a perda (apague/trunque) → detecte pela comparação → restaure → compare de novo. Meça o tempo (isto é o seu RTO).
6. Se o banco restaurado vier de dados reais: rode `mask-restored.sql` na cópia (ver o cabeçalho do arquivo) **antes** de qualquer pessoa abrir tabelas, confira só contagens e hashes (`fingerprint.sql`) e depois apague o banco e os arquivos temporários.

Achados do exercício real que mudaram os scripts: o dump com `--schema` **não carrega a publicação do Realtime** (`post-restore.sql` a recoloca e `fingerprint.sql` confere); o dump agora **mantém os GRANTs** (sem eles o app restaurado perderia as permissões
de `anon`/`authenticated`); um dump truncado passa no SHA-256 do arquivo cifrado, por isso o dump é lido por `pg_restore --list`
**antes** de cifrar; `pg_restore` precisa de `--clean --if-exists` porque o dump recria o esquema `public`.

## Custos e decisões pendentes (do proprietário)

- Plano pago do banco (backup diário gerenciado; PITR é opcional e mais caro) — **decisão e contratação do dono**.
- Provedor e conta do armazenamento externo (e quem é o dono da conta).
- Quem guarda a chave privada e onde fica a segunda cópia offline.
- Aprovar RPO/RTO e a política de retenção; prazo de guarda frente à LGPD (backups contêm dados pessoais: definir tempo máximo
  e como atender pedidos de exclusão em backups).
- Onde roda o agendamento (CI do repositório, uma máquina do dono ou um servidor pequeno).

## Exemplo de agendamento seguro

Ver `github-actions.example.yml`: roda diariamente, usa **segredos do repositório** (nunca valores no arquivo), só tem a
chave **pública**, envia o `.gpg` ao armazenamento externo e avisa o monitor. Copie para `.github/workflows/` **somente
depois** de configurar os segredos e de aprovar. Alternativa: agendador do sistema (cron / Agendador de Tarefas) na máquina do dono
com as variáveis em arquivo fora do Git.
