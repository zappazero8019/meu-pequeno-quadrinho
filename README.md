# Meu Pequeno Quadrinho

Aplicativo web infantil, instalável como PWA, para criar histórias em quadrinhos.

> **Status: Fase 1 — estrutura, identidade visual e navegação.**
> Nenhum desenho, narração, história ou backup é salvo nesta versão. Todos os
> recursos ainda não implementados aparecem explicitamente como **"em breve"**
> e seus botões estão desativados.

## O que está implementado

- Tela inicial com logotipo, chamada principal "Criar minha história", acesso à
  biblioteca, às histórias para ouvir, aos backups e ilustração temática.
- Biblioteca com estado vazio amigável e um **modelo visual** de cartão
  (capa, título, autor e data) claramente identificado como prévia — nenhuma
  história falsa é exibida.
- Formulário de nova história com validação de campos obrigatórios e tamanho
  mínimo, contadores de caracteres e mensagens de erro acessíveis.
- Tela de preparação do editor seguida da estrutura visual do editor com:
  identificação da história, página, área de desenho, modos (desenho livre e
  quadrinhos), espaços reservados para ferramentas e paleta, área de narração e
  navegação entre páginas.
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

## O que ainda NÃO está implementado

- Motor de desenho livre e modo quadrinhos.
- Ferramentas, paleta de cores e seleção real de cores.
- Gravação, reprodução e armazenamento de áudio.
- Persistência de histórias (localStorage, IndexedDB ou qualquer outro meio).
- Exportação/importação real de backups.
- Capas, títulos, autores e datas reais na biblioteca.

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
│   │   ├── state.js         # estado em memória (sem persistência)
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

## Decisões e limitações conhecidas

- O roteador usa `hash` (`#/tela`) para funcionar em hospedagem estática sem
  reescrita de URLs.
- Links internos são interceptados pelo roteador para manter o histórico; o
  botão voltar nativo do navegador continua funcionando. Após usar o voltar
  nativo, o botão "Voltar" do aplicativo retorna ao início.
- O estado vive apenas em memória: recarregar a página descarta título, autor e
  página atual. Isso é intencional nesta fase.
- Nenhuma dependência externa foi instalada. Ícones e ilustrações são SVGs
  originais; os PNGs do PWA foram gerados localmente com Pillow já disponível.

## Confirmação

Todas as alterações foram feitas exclusivamente dentro de
`C:\Users\Samuel\Documents\meu-pequeno-quadrinho`. Nenhum arquivo fora desse
diretório foi criado, modificado ou excluído. O diretório estava vazio no início
do trabalho, portanto não houve arquivos existentes para sobrescrever nem
backups a realizar.

**A Fase 2 não foi iniciada. Aguardando aprovação explícita.**
