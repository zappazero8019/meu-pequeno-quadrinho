# Meu Pequeno Quadrinho

Aplicativo web infantil, instalável como PWA, para criar histórias em quadrinhos.

> **Status: modo expandido e narração por página — implementados.**
> A biblioteca lê as histórias reais do IndexedDB, mostra capa, título, autor,
> páginas e data de atualização, permite continuar a história mais recente pela
> tela inicial e excluir somente após confirmação explícita. O editor recupera
> ID, metadados e desenhos pelo link `#/editor?story=<id>` e agora expõe, também
> no modo expandido, página anterior, próxima página, apagar tudo e a narração
> com a voz original da criança (MediaRecorder + Blob no IndexedDB). Quadrinhos,
> backups e demais recursos futuros seguem marcados como **"em breve"**.

## O que está implementado

- Tela inicial com logotipo, chamada principal "Criar minha história", acesso à
  biblioteca, às histórias para ouvir, aos backups e ilustração temática.
- Biblioteca ligada ao IndexedDB: histórias reais ordenadas pela atualização
  mais recente, com capa (quando existir), título, autor, páginas e data, além
  de estados de carregamento, vazio, erro de leitura e erro de exclusão.
- Formulário de nova história com validação de campos obrigatórios e tamanho
  mínimo, contadores de caracteres e mensagens de erro acessíveis.
- Tela de preparação do editor seguida do editor com: identificação da história,
  página, área de desenho funcional (normal ou expandida), ferramentas de lápis,
  pincel e borracha, paleta de oito cores, três espessuras, botão "Apagar tudo"
  com confirmação, modos (desenho livre pronto e quadrinhos em breve), narração
  por página e navegação entre páginas. No modo expandido, ferramentas, cores,
  espessuras, Desfazer/Refazer, apagar tudo, navegação e narração continuam
  acessíveis em barras compactas, sem cobrir o meio da área de desenho.
- Tela de leitura com prévia do livro, paginação funcional e controle de áudio
  visualmente desativado.
- Tela de backups com exportação, importação e informações de proteção apenas
  preparadas visualmente.
- Tela para rotas inexistentes.
- Navegação por hash com histórico interno e botões "Voltar" funcionais.
- PWA: `manifest.json`, ícones PNG gerados localmente, Service Worker com cache
  do app shell.
- Layout responsivo para celulares pequenos, telas maiores e orientação
  paisagem, com áreas de toque de pelo menos 44 px.
- Infraestrutura de persistência local em IndexedDB: criar, buscar, listar,
  atualizar e excluir histórias, com páginas e desenhos serializáveis.
- Editor integrado ao banco: identificador estável por história, recuperação
  dos desenhos ao abrir, fila serial de gravação e indicador de estado.
- Narração real por página: gravar, parar, ouvir, pausar, ouvir de novo e
  excluir com confirmação. O áudio é a voz captada pelo microfone, gravada como
  `Blob` no mesmo IndexedDB local, com chave estável `história + página`.
- O microfone só é solicitado ao tocar em **Gravar narração**. Não há síntese de
  voz, vozes artificiais, envio a servidor, nuvem ou compartilhamento.

## O que ainda NÃO está implementado

- Modo quadrinhos com quadros e divisões de página.
- Zoom, exportação de imagem ou PDF e capa automática.
- Exportação de áudio, PDF ou ZIP com narração, nuvem e compartilhamento.
- Capa automática gerada pelos desenhos (a capa gravada é exibida quando
  existir; histórias sem capa mostram apenas um marcador neutro).
- Exportação/importação real de backups.

## Estrutura de arquivos

```text
meu-pequeno-quadrinho/
├── index.html
├── manifest.json
├── sw.js
├── README.md
├── src/
│   ├── app/
│   │   ├── router.js        # rotas por hash, histórico e registro do SW
│   │   ├── drawing.js       # motor Canvas 2D, ponteiros e buffers em memória
│   │   ├── drawing-data.js  # formato serializável das operações de desenho
│   │   ├── database.js      # IndexedDB: histórias, páginas e operações
│   │   ├── story-storage.js # fila de gravação, recuperação e estado do salvamento
│   │   ├── library-data.js  # listagem, abertura e exclusão da biblioteca
│   │   ├── narration-controller.js # MediaRecorder, reprodução e estados
│   │   ├── state.js         # rascunho em memória com ID estável da história
│   │   ├── utils.js         # escape de HTML e helpers de ícones
│   │   └── pwa.js           # registro do Service Worker
│   ├── screens/
│   │   ├── home.js
│   │   ├── library.js
│   │   ├── new-story.js
│   │   ├── editor.js
│   │   ├── reader.js
│   │   ├── backups.js
│   │   └── not-found.js     # tela para rotas inexistentes
│   └── styles/
│       ├── main.css         # tokens, reset e layout do app shell
│       ├── components.css   # botões, cartões, formulários e placeholders
│       └── responsive.css   # breakpoints, paisagem e movimento reduzido
├── tests/
│   ├── drawing-engine.test.mjs
│   ├── database.test.mjs
│   ├── story-storage.test.mjs
│   ├── library.test.mjs
│   └── helpers/             # fakes mínimos, sem dependências externas
└── assets/
    ├── icons/               # SVGs locais + ícones PNG do PWA
    └── illustrations/       # ilustrações originais em SVG
```

`not-found.js`, `utils.js`, `pwa.js` e os SVGs locais foram adicionados em
relação à estrutura sugerida para, respectivamente: tratar rotas inexistentes,
evitar repetição de código, isolar o registro do Service Worker e eliminar
dependências de imagens externas ou protegidas.

## Como executar localmente

É necessário um servidor HTTP estático porque o projeto usa módulos ES e
Service Worker. Não é preciso instalar dependências.

```powershell
cd C:\Users\Samuel\Documents\meu-pequeno-quadrinho
py -m http.server 8000
```

Acesse `http://localhost:8000` no navegador.

Também é possível usar qualquer servidor estático já instalado, desde que a
raiz seja a pasta do projeto.

## Como acessar no Android pela rede local

1. No computador, descubra o IP na rede:

   ```powershell
   ipconfig
   ```

   Procure o campo **Endereço IPv4** do adaptador Wi-Fi (ex.: `192.168.1.23`).

2. Inicie o servidor escutando em todas as interfaces:

   ```powershell
   py -m http.server 8000 --bind 0.0.0.0
   ```

3. libere a porta 8000 no Firewall do Windows, se necessário.

4. No celular Android, conecte-se à mesma Wi-Fi e abra:

   ```text
   http://IP_DO_COMPUTADOR:8000
   ```

5. Para abrir como aplicativo, use o menu do Chrome → **Adicionar à tela
   inicial** / **Instalar aplicativo**.

**Observação importante:** Service Workers e o prompt de instalação de PWA
exigem contexto seguro. `localhost` é considerado seguro no computador, mas um
endereço `http://IP:8000` na rede local **não** é. Assim, o aplicativo abre e
navega normalmente no celular, mas o Service Worker e a instalação como PWA
podem não funcionar até que o site seja servido via HTTPS (ou por um túnel
HTTPS). Isso é uma limitação do navegador, não do código.

## Testes executados na Fase 1

| Teste | Resultado |
| --- | --- |
| Estrutura de arquivos | 44 arquivos criados; todos os caminhos conferidos |
| Sintaxe JavaScript (`node --input-type=module --check`) | 12 arquivos, 0 falhas |
| JSON do manifest | Válido; 3 ícones existentes e com tamanhos corretos |
| SVGs | 22 arquivos bem-formados, 0 inválidos |
| Arquivos referenciados no Service Worker | 42 entradas, 0 faltando |
| Erros de console do navegador | Nenhum erro; SW registrado com sucesso |
| Requisições com falha ou HTTP 4xx/5xx | Nenhuma |
| Abertura das 7 telas | Todas acessíveis, títulos corretos |
| Navegação e botões "Voltar" | Funcionais; histórico verificado |
| Validação do formulário | Campos vazios e valores curtos rejeitados; valores válidos aceitos |
| Paginação do editor e do leitor | Funcional |
| Estados "em breve" | Botões desativados e identificados como não implementados |
| Responsividade 317 px (retrato) e 652 px (paisagem) | Sem overflow horizontal; alvos de toque ≥ 44 px; 1 coluna no retrato estreito e 2 na paisagem |
| Lighthouse (Início, Nova história, Biblioteca, Leitura, Backups) | Acessibilidade 1.00, Boas Práticas 1.00 e SEO 1.00 em todas |
| Service Worker | Ativo, cache `meu-pequeno-quadrinho-v3` com 43 entradas |

Não foi possível capturar screenshots porque a janela do navegador do ambiente
de testes não estava visível; a inspeção visual foi feita por árvore de
acessibilidade, métricas de layout e auditoria automatizada.

## Testes do motor de desenho (correção dos limites)

Os testes automatizados ficam em `tests/drawing-engine.test.mjs` e usam apenas
recursos nativos do Node:

```
node --test tests/drawing-engine.test.mjs
```

Eles cobrem traços iniciados junto às quatro bordas, traço diagonal completo,
coordenadas acima do antigo limite de 600 unidades, lápis/pincel/borracha,
eventos coalescidos, preservação do conteúdo entre retrato e paisagem, desfazer
e refazer de traços, borracha e limpeza, histórico por página, novo traço após
Desfazer, redimensionamento e modo expandido.

A validação final no Moto G35 ainda precisa ser feita no aparelho. Testes
sintéticos e simulações de viewport não substituem o uso real do dedo na tela.

## Desfazer e Refazer (Fase 2.2)

O histórico fica em memória, dentro do registro de cada página no motor de
desenho. Em vez de guardar uma imagem completa do canvas por ação, o motor
registra apenas as operações de cada traço concluído (ponto, segmento, cor,
espessura) e a ação de limpeza. Desfazer e Refazer reconstruem o desenho a
partir dessas operações, sem cópias de canvas durante o movimento do dedo.

- Cada traço completo é uma ação, incluindo os traços da borracha.
- "Apagar tudo" também é uma ação e pode ser desfeito/refeito.
- Um novo traço após Desfazer descarta o histórico de Refazer.
- Cada página tem seu próprio histórico; trocar de página não mistura ações.
- Limite: **30 ações por página**. Ao completar a 31ª ação, a mais antiga é
  descartada. Os desenhos na tela não são alterados, mas ações antigas deixam
  de poder ser desfeitas.
- Os botões ficam desabilitados quando não há o que desfazer ou refazer.

## Banco local (Fase 3.1)

O módulo `src/app/database.js` abre o banco `meu-pequeno-quadrinho`, versão 2,
com os object stores `stories` e `narrations`, ambos indexados pelo `id`. Cada história guarda apenas a
cópia atual: `id`, `title`, `author`, `createdAt`, `updatedAt`, `cover`, `pages` e
`pageCount`. Cada página guarda `id`, `order`, `drawing` e `updatedAt`. O
`pageCount` é calculado a partir de `pages`, para não ficar dessincronizado.

Funções disponíveis: `initDatabase()`, `isDatabaseAvailable()`,
`closeDatabase()`, `createStory(input)`, `getStory(id)`, `listStories()`,
`updateStory(id, patch)`, `deleteStory(id)`, `saveNarrationForStory(input)`,
`getNarration(storyId, pageId)`, `listNarrations(storyId)`,
`deleteNarrationForStory(storyId, pageId)` e `touchStory(id)`. Atualizações usam
`put` com o mesmo `id` e nunca criam versões antigas; exclusões usam `delete`
apenas para o `id` informado. A migração v1 → v2 cria somente a loja
`narrations`: nenhuma história, desenho ou índice existente é apagado ou
recriado. Falhas de abertura, leitura, gravação, transação, dados inválidos e
quota são convertidas em `DatabaseError` com um código verificável.

Os desenhos são serializados por `serializePageDrawing(draft, page)` em
`src/app/drawing.js`, com o formato validado por `src/app/drawing-data.js`:
coordenadas, cor, espessura, ferramenta (lápis, pincel ou borracha), ordem das
operações, ações de limpeza e `historyIndex` de Desfazer/Refazer. Não são
gravados canvas, contextos 2D, eventos, funções nem imagens de bitmap.

Testes: `node --test tests/database.test.mjs`. Eles usam um polyfill mínimo em
`tests/helpers/fake-indexeddb.mjs` — sem dependências externas — e nunca abrem
o banco real do navegador. Também não há limpeza automática de dados: a
capacidade depende dos limites do navegador e do aparelho.

## Integração e salvamento automático (Fase 3.2)

`src/app/story-storage.js` liga o editor ao módulo da Fase 3.1. O rascunho em
`state.js` passa a ter `storyId`, `cover`, `createdAt`, `updatedAt` e a lista de
páginas com `id`, `order` e `updatedAt`. A rota `#/editor?story=<id>` permite
reabrir uma história existente, inclusive depois de recarregar a página; a
biblioteca passou a gerar esse link na Fase 3.3.

Ao abrir o editor, `ensureStoryLoaded()` busca a história pelo ID. Se ela não
existir, cria uma com o mesmo ID e com páginas vazias. Depois disso,
`restorePageDrawing()` cria um buffer novo para cada página, repinta as ações e
restaura `historyIndex`. Nenhum canvas antigo é reaproveitado e nenhuma função
ou referência não serializável volta do banco.

A gravação acontece depois de uma ação concluída: traço, borracha, limpeza,
Desfazer ou Refazer. Não há gravação durante `pointermove`. A fila mantém uma
transação por vez; alterações que chegam durante ela são agrupadas no snapshot
mais recente. Assim, a ordem é preservada, uma gravação antiga nunca substitui a
nova e o estado **Salvo.** só aparece após a confirmação da transação. Se houver
falha, o estado **Erro ao salvar.** aparece, o snapshot fica guardado para nova
tentativa e o desenho continua em memória. Trocar de página ou sair do editor
pede o esvaziamento da fila quando possível.

Testes: `node --test tests/story-storage.test.mjs`. A suíte cobre os 16 casos
exigidos e três verificações adicionais (IndexedDB indisponível, falha na
recuperação e conexão fechada durante a gravação), incluindo falhas simuladas de
quota e transação, evidência de que o ID e `createdAt` sobrevivem a atualizações
e recuperação após fechar/reabrir a conexão. O Service Worker passou para o
cache `v11` nessa fase e inclui os novos módulos.

## Biblioteca funcional (Fase 3.3)

`src/app/library-data.js` usa `listStories()`, `getStory()` e `deleteStory()` do
módulo da Fase 3.1 — nenhum segundo banco foi criado. A tela `src/screens/library.js`
mostra apenas histórias persistidas, ordenadas por `updatedAt`, e distingue
carregamento, biblioteca vazia, lista disponível, falha de leitura e falha de
exclusão. Um erro de leitura nunca é mostrado como "biblioteca vazia".

Ao tocar em **Continuar**, a aplicação confirma o ID com `getStory()`, prepara
o rascunho com `prepareDraftForStory()` e navega para `#/editor?story=<id>`.
Assim, o editor recupera metadados e desenhos pelo mesmo ID, sem criar outra
história. A tela inicial exibe o botão **Continuar última história** somente
quando existe alguma história salva; ele usa a mesma confirmação de ID.

A exclusão abre uma janela de confirmação com o nome da história. **Cancelar**
não chama o banco. **Excluir história** desativa os botões durante a operação,
chama `deleteStory(id)` e só atualiza a listagem depois da confirmação da
transação. Se houver erro, a história continua visível, aparece uma mensagem e
o botão **Tentar novamente** reabre a confirmação. A proteção na camada de dados
também reutiliza a mesma promessa quando há cliques repetidos no mesmo ID.

Testes: `node --test tests/library.test.mjs`. A suíte cobre os 15 casos
exigidos mais duas verificações (ID inexistente e falha na consulta de abertura),
usando os fakes locais das fases anteriores e bancos isolados. O Service Worker
passou para o cache `v12` e inclui `library-data.js`.

## Modo expandido e narração por página

Os mesmos botões e handlers de paginação e limpeza do editor foram mantidos; o
modo expandido apenas os reorganiza em faixas compactas no topo e no fim da
tela. Página anterior e próxima página ficam desabilitadas nos limites (e
também durante a gravação). Antes de trocar de página, o editor chama
`flushPendingSaves()` para concluir a fila de autosave; o histórico
Desfazer/Refazer e as cores/espessuras continuam funcionando. **Apagar tudo**
ainda pede confirmação e apaga somente os desenhos da página atual: as narrações
não são afetadas.

`src/app/narration-controller.js` encapsula `MediaRecorder`, `getUserMedia`,
`Blob`, reprodução e os estados da narração. O microfone é pedido somente no
clique de **Gravar narração**. Cada página tem sua própria gravação, guardada
como `Blob` na loja `narrations` com a chave determinística
`[storyId, pageId]`; gravar de novo substitui o áudio anterior, sem duplicar
registros. A exclusão da história também remove as narrações órfãs na mesma
transação, e a exclusão de uma narração atualiza a história sem tocar nos
desenhos. A interface mostra gravação em andamento, duração, presença de
narração e mensagens claras para navegador sem suporte, permissão negada, sem
microfone, gravação interrompida/falha, erro de armazenamento e quota excedida.
Se a gravação falhar, o desenho e o autosave permanecem intactos e há a opção
**Tentar salvar novamente** quando o áudio ainda está em memória.

Testes: `node --test tests/narration.test.mjs` (17 casos) cobrem gravação e
recuperação, associação história/página, narrações independentes, reprodução,
pausa, repetição e exclusão, persistência após reabrir, permissão negada, sem
suporte, falha de armazenamento, quota, migração v1 → v2 sem perda, navegação,
flush do autosave antes da troca de página, limpeza sem apagar áudio,
preservação do histórico e cancelamento/interrupção/falha do gravador. O
Service Worker passou para o cache `v14` e inclui `narration-controller.js`.

## Decisões e limitações conhecidas

- O roteador usa `hash` (`#/tela`) para funcionar em hospedagem estática sem
  reescrita de URLs.
- Links internos são interceptados pelo roteador para manter o histórico; o
  botão voltar nativo do navegador continua funcionando. Após usar o voltar
  nativo, o botão "Voltar" do aplicativo retorna ao início.
- Sem o parâmetro `?story=<id>` na URL, recarregar a página volta ao rascunho em
  memória. Para retomar, use o botão da biblioteca ou **Continuar última história**
  na tela inicial; ambos confirmam o ID no banco antes de abrir o editor.
- Fechar o aplicativo no meio de uma transação pode interrompê-la. O conteúdo
  permanece em memória enquanto a aba existe e pode ser reenviado; não há
  garantia de gravação após o processo ser encerrado.
- Nenhuma dependência externa foi instalada. Ícones e ilustrações são SVGs
  originais; os PNGs do PWA foram gerados localmente com Pillow já disponível.
  Os testes de IndexedDB usam um polyfill local, também sem dependências.

## Confirmação

Todas as alterações foram feitas exclusivamente dentro de
`C:\Users\Samuel\Documents\meu-pequeno-quadrinho`. Antes de modificar arquivos
existentes, cópias foram preservadas em `.backup-modo-expandido-narracao/`; os
backups das fases anteriores (incluindo `.backup-fase3.3/`) foram mantidos.

**Modo expandido e narração por página foram implementados. Aguardando revisão e
validação física no Moto G35 com Android 15 antes de qualquer outra fase.**
