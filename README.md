# PPF Painel Multitask

Aplicativo desktop (Electron) para lojas **Pizza Pizza Franquias**. Abre vários sistemas web no mesmo painel, em tela cheia (kiosk), com uma barra de navegação na parte inferior.

Sistemas atuais:

| Botão    | URL |
|----------|-----|
| Início   | Tela local do app |
| Cardápio | https://portal.cardapioweb.com |
| iFood    | https://gestordepedidos.ifood.com.br/#/login |
| Gestão   | https://portal.ifood.com.br |
| RWP      | https://www.rederwp.com/src/login.php |

---

## O que cada arquivo faz

| Arquivo | Função |
|---------|--------|
| `main.js` | Processo principal do Electron: janela, kiosk, cookies de terceiros para iframes |
| `frame-policy.js` | Bypass de `X-Frame-Options` / CSP (`*.cardapioweb.com`, iFood, RWP) |
| `painel.html` | Interface: iframes das páginas + botões do dock. **É aqui que se adiciona página nova** |
| `preload.js` | Isolamento de segurança (não precisa alterar no uso normal) |
| `package.json` | Nome, **versão**, scripts de start/build, lista de arquivos empacotados |
| `criar-deb.py` | Gera o `.deb` Debian a partir de `dist/linux-unpacked` (funciona no Mac) |
| `criar-deb.sh` | Mesmo `.deb`, via Docker (`dpkg-deb`). Se o Docker não estiver disponível, chama o Python |
| `instalar-linux.sh` | Instala o pacote gerado em um Linux (`.deb`, AppImage ou `.tar.gz`) |
| `config.json` | Dono/repo do GitHub de onde as lojas baixam a atualização |
| `updater.js` | No ligar (e a cada 4 h) consulta o **GitHub Releases**, baixa, instala |
| `linux/update-helper.sh` | Script root no `.deb` que instala só o pacote oficial |
| `scripts/publish-github.sh` | Sobe o `.deb`/AppImage como Release (se você buildou no Mac) |
| `.github/workflows/release.yml` | Ao dar `git push` numa tag `v*`, o GitHub builda e publica sozinho |

---

## Requisitos

- **Node.js** 18 ou superior
- **npm**
- Para gerar o `.deb` no Mac: **Python 3** (já vem no macOS) **ou** Docker

Instalação das dependências (na pasta do projeto):

```bash
cd /caminho/para/painel-electron
npm install
```

---

## Rodar em desenvolvimento

```bash
# No Mac: janela normal. No Linux da loja: tela cheia / kiosk
npm start

# Forçar kiosk (também no Mac)
npm run start:kiosk

# Forçar janela (também no Linux)
npm run start:windowed

# Testes de força / regressão (Python, ~30 casos)
npm test
```

No Mac o kiosk cobre a tela inteira e a segunda vez que você dá `npm start` a janela nova fecha na hora (só pode haver um app aberto). Por isso o desenvolvimento no Mac usa janela.

**Sair do kiosk:** `Ctrl+Shift+Q`

Se aparecer `PPF Painel já está aberto`, feche o app no Dock (ícone Electron) ou `Ctrl+Shift+Q` e rode de novo.

---

## Como adicionar uma página nova

Todas as páginas (exceto Início) são **iframes** dentro de `painel.html`. O carregamento é preguiçoso: a URL só vai para `src` na primeira vez que o botão é clicado (`data-src`).

Use um **id curto**, só letras minúsculas, sem espaços (ex.: `rappi`, `whatsapp`, `nfe`). Esse id aparece em três lugares e precisa ser **igual**.

### Passo 1 — Cor da aba (opcional)

No `<style>` de `painel.html`, nas variáveis `:root`, adicione uma cor:

```css
:root {
    /* ... cores existentes ... */
    --btn-rappi: #ff441f;
}
```

E uma classe para o botão (junto das outras `.btn-*`):

```css
.btn-rappi { background: var(--btn-rappi); }
```

Se não fizer isso, o botão fica com a cor cinza do Início.

### Passo 2 — Iframe

Dentro de `<main class="main-container">`, depois dos iframes existentes, acrescente:

```html
<iframe
    id="iframe-rappi"
    class="page-frame"
    allow="autoplay; clipboard-read; clipboard-write"
    data-src="https://exemplo.com/login">
</iframe>
```

Regras:

- `id` **obrigatório** no formato `iframe-` + o id da página (`iframe-rappi`)
- Use `data-src` (não `src`) para não carregar o site até o usuário clicar
- `class="page-frame"` é obrigatório (o JS esconde/mostra por essa classe)

### Passo 3 — Botão no dock

Dentro de `<nav class="dock">`, acrescente um botão:

```html
<button type="button" onclick="showPage('rappi', this)" class="nav-btn btn-rappi">Rappi</button>
```

O primeiro argumento de `showPage` deve ser **o mesmo id** (`rappi`), sem o prefixo `iframe-`.

### Passo 4 — Conferir

Não é preciso alterar `showPage()` em `painel.html`, nem `main.js`, na maioria dos casos.

1. Rode `npm run start:windowed`
2. Clique no botão novo
3. Confirme que o site abre no iframe

Se a página aparecer **em branco**:

- O site pode bloquear iframe (`X-Frame-Options` / CSP). O `main.js` já remove esses headers no Electron; isso **não funciona** se você abrir o `painel.html` só no Chrome.
- Confira se o `id` do iframe é `iframe-` + o nome passado no `showPage`.
- Confira se a URL está em `data-src` (com `https://`).

### Passo 5 — Arquivos extras (só se criar arquivos novos)

O build só empacota o que está em `package.json` → `build.files`:

```json
"files": [
  "main.js",
  "frame-policy.js",
  "updater.js",
  "preload.js",
  "painel.html",
  "config.json",
  "package.json"
]
```

Se você criar, por exemplo, `logo.png` ou `paginas/foo.html` e referenciar no HTML, **adicione o caminho nessa lista**. Caso contrário o app empacotado não inclui o arquivo.

Não é necessário incluir a nova página nessa lista se ela for só um iframe para um site externo.

---

## Como criar uma versão nova

A versão do app aparece no `package.json` **e** nos scripts que geram o `.deb`. Se você mudar só um lugar, o instalador Debian fica com número errado.

Convenção semântica: `MAJOR.MINOR.PATCH` (ex.: `1.0.0` → `1.1.0` se adicionar página; `1.0.1` se for só correção).

### Passo 1 — `package.json`

Altere o campo `"version"`:

```json
"version": "1.1.0"
```

Esse valor vai para o Electron, AppImage e `.tar.gz`.

### Passo 2 — `criar-deb.py`

Atualize **os dois** pontos (nome do arquivo de saída e constante):

```python
OUT = ROOT / "dist" / "ppf-painel-multitask_1.1.0_amd64.deb"
...
VERSION = "1.1.0"
```

### Passo 3 — `criar-deb.sh`

```bash
VERSION="1.1.0"
```

O arquivo gerado será `dist/ppf-painel-multitask_1.1.0_amd64.deb`.

### Passo 4 — Conferir

Procure `1.0.0` (ou a versão antiga) no projeto e confirme que não sobrou:

```bash
grep -n "1.0.0" package.json criar-deb.py criar-deb.sh
```

Não altere a versão dentro de `package-lock.json` na mão; o `npm` atualiza sozinho quando você instala dependências. O número que importa para o produto é o de `package.json`.

### Passo 5 — (Opcional) Git

Depois de testar o build:

```bash
git add package.json criar-deb.py criar-deb.sh painel.html
git commit -m "Release 1.1.0: adiciona página Rappi"
git tag v1.1.0
```

---

## Como buildar o app

Os artefatos saem na pasta `dist/`.

### Linux amd64 (lojas) — fluxo principal

No Mac ou no Linux, na pasta do projeto:

```bash
npm install
npm run dist:linux
```

Isso faz:

1. `electron-builder` gera **AppImage**, **tar.gz** e a pasta `dist/linux-unpacked`
2. `python3 criar-deb.py` gera o **`.deb`** válido

Arquivos típicos:

```
dist/PPF Painel Multitask-1.1.0.AppImage
dist/ppf-painel-multitask-1.1.0.tar.gz
dist/ppf-painel-multitask_1.1.0_amd64.deb
dist/linux-unpacked/          ← binário já descompactado (usado pelo .deb)
```

**Não use** o `.deb` que o electron-builder às vezes gera sozinho no Mac: ele sai corrompido (poucos bytes). O pacote certo é o criado por `criar-deb.py` / `criar-deb.sh`.

### Só gerar o `.deb` (já existe `linux-unpacked`)

```bash
# Precisa ter rodado um dist Linux antes
python3 criar-deb.py

# ou, com Docker:
./criar-deb.sh
```

`npm run dist:linux:deb` empacota só a pasta (`--linux dir`) e em seguida chama o Python — útil se você não precisa de AppImage/tar.gz.

### Linux ARM64 (Raspberry Pi / alguns Mini PCs)

```bash
npm run dist:linux:arm64
```

Gera AppImage e tar.gz para **arm64**. O script Python de `.deb` atual é **amd64**; não use esse `.deb` em máquina ARM.

### macOS (teste interno)

```bash
npm run dist:mac
```

Gera pasta do app em `dist/` (não é o instalador das lojas).

### Pasta sem instalador

```bash
npm run pack
```

Gera o app descompactado em `dist/` para inspecionar arquivos.

---

## Instalar nas lojas (Linux)

Copie o `.deb` (ou rode o script na máquina da loja, se a pasta `dist/` estiver lá):

```bash
sudo dpkg -i dist/ppf-painel-multitask_1.1.0_amd64.deb
sudo apt-get install -f -y
```

Ou:

```bash
chmod +x instalar-linux.sh
./instalar-linux.sh
```

O script prefere um `.deb` válido; se não houver, usa AppImage ou tar.gz.

Comandos depois de instalado:

```bash
ppf-painel              # kiosk / tela cheia
ppf-painel --no-kiosk   # janela normal
```

- Executável do pacote `.deb`: `/usr/bin/ppf-painel` → `/opt/ppf-painel/ppf-painel`
- Atalho no menu: **PPF Painel Multitask**
- Sair: `Ctrl+Shift+Q`

No Debian/KDE o app força **X11** no kiosk (`ELECTRON_OZONE_PLATFORM_HINT=x11`), porque tela cheia no Wayland costuma falhar.

---

## Atualização automática (100 lojas)

**Não use Hostinger/VPS para isso, nem `git pull` nas lojas.**

- `git pull` + `npm install` em 100 PDVs é pesado, quebra fácil e não é como se atualiza app Electron empacotado.
- Subir `.deb` na hospedagem web funciona, mas você vira CDN: Nginx, disco, `rsync`, HTTPS.

O caminho **mais simples e o padrão do Electron**: **GitHub Releases**.

1. Você sobe uma tag (`v1.2.0`)
2. O GitHub guarda o instalador (CDN grátis)
3. Cada loja, ao ligar, pergunta: “qual é o último Release?”
4. Se for mais novo, baixa o `.deb`, instala e mostra **Atualizado com sucesso**

Repo já apontado em `config.json`: [Rede-RWP/painel-eletron](https://github.com/Rede-RWP/painel-eletron).

O Release (pelo menos os arquivos) precisa ser **público**. Repositório privado exige token dentro do app — não faça isso. Se o código não puder ser público, crie um repo só para os instaladores.

PCs precisam da **1.1.0+** instalada **uma vez**. Depois disso você não visita mais as 100 lojas.

Desligar: `ppf-painel --no-update` ou `PPF_PAINEL_UPDATE=0`.  
GitHub fora do ar: o painel abre normal e tenta de novo em 4 h.

### Publicar — jeito 1 (melhor): só a tag

No Mac, com as versões iguais em `package.json`, `criar-deb.py` e `criar-deb.sh`:

```bash
git add -A
git commit -m "Release 1.2.0"
git tag v1.2.0
git push origin main
git push origin v1.2.0
```

A Action `.github/workflows/release.yml` builda no Ubuntu (`.deb` com o helper, AppImage) e anexa no Release. Espere o ✓ do GitHub Actions.

### Publicar — jeito 2: você já buildou no Mac

```bash
npm run dist:linux
./scripts/publish-github.sh "Nova aba X"
# ou: npm run publish:github
```

Precisa do [GitHub CLI](https://cli.github.com/) (`gh auth login`).

### O que acontece na loja

1. Liga o PC (ou o app reconsulta a cada 4 h)
2. Lê `https://api.github.com/repos/Rede-RWP/painel-eletron/releases/latest`
3. Compara a tag (`v1.2.0`) com a versão local
4. Overlay → download → `dpkg` (helper) ou troca do AppImage → sucesso → reinicia

### Primeira vez nas 100 lojas

Instale uma vez o `.deb` 1.1.0+ (o da Release, não o `.deb` de 96 bytes do Mac):

```bash
sudo dpkg -i ppf-painel-multitask_1.1.0_amd64.deb
sudo apt-get install -f -y
```

---

## Checklist rápido de release

1. Alterar `painel.html` (página nova, se houver)
2. Testar com `npm run start:windowed`
3. Subir versão em `package.json`, `criar-deb.py` e `criar-deb.sh`
4. `git commit` + `git tag vX.Y.Z` + `git push origin vX.Y.Z`
5. Esperar o GitHub Actions publicar o Release (ou `npm run dist:linux` + `./scripts/publish-github.sh`)
6. Ligar um PC de teste já na 1.1.0+ e confirmar o overlay de sucesso
7. (Só na 1.1.0) instalar o `.deb` uma vez em cada loja que ainda não tem o atualizador

---

## Solução de problemas

| Problema | O que fazer |
|----------|-------------|
| Página em branco no iframe | Testar no app Electron, não no navegador; conferir `id` / `data-src` |
| `.deb` minúsculo no Mac | Ignorar o `.deb` do builder; usar `criar-deb.py` |
| `Não achei dist/linux-unpacked/ppf-painel` | Rodar `npm run dist:linux` antes do Python |
| Kiosk não cobre a tela no KDE | Manter o launcher padrão (X11); não forçar Wayland |
| Dois apps abertos | O lock de instância única reusa a janela existente |
| Arquivo novo não aparece no instalador | Incluir o caminho em `build.files` no `package.json` |
| Loja não atualiza sozinha | Conferir se já é 1.1.0+; se o repo/Release é público; se a tag `v*` é maior que a versão local |
| Overlay de erro no sudo | O helper/`sudoers` só entra no `.deb` desta versão; reinstale o 1.1.0 uma vez |
| GitHub 404 | Repo privado ou ainda não existe Release; o app falha quieto e tenta em 4 h |
| Linux trava / congela o SO | Atualize para 1.1.5+ (descarrega iFood/Gestão/RWP inativos; Cardápio mantém sessão). PDV com ≤4 GB RAM: use só as abas necessárias |
| Cardápio Web em branco | 1.1.5+ bypassa `*.cardapioweb.com` e libera storage de terceiros no iframe. Confirme que `frame-policy.js` está no pacote |
