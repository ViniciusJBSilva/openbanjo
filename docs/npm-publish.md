# Publicar o OpenBanjo no npm

O pacote npm `openbanjo` instala um launcher que baixa um AppImage Linux x64 ja
compilado do GitHub Releases. Depois de publicado, o fluxo para o usuario e:

```bash
npm install -g openbanjo
openbanjo
```

Esse modelo nao exige Rust, Cargo nem Tauri CLI na maquina do usuario final. No
primeiro pacote de binario, o suporte via npm e apenas Linux x64.

## Antes de publicar

1. Confirme que as versoes batem em `package.json`, `src-tauri/tauri.conf.json`
   e `src-tauri/Cargo.toml`.
2. Rode as verificacoes locais:

```bash
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

3. Confira o conteudo que vai para o npm:

```bash
npm run pack:check
```

## Publicar o binario no GitHub Releases

Crie e envie uma tag. O workflow `.github/workflows/release.yml` vai gerar e
publicar `openbanjo-linux-x64.AppImage` e
`openbanjo-linux-x64.AppImage.sha256`.

```bash
git tag v0.2.0
git push origin v0.2.0
```

Antes de publicar no npm, confirme que os dois assets existem em:

```text
https://github.com/ViniciusJBSilva/openbanjo/releases/tag/v0.2.0
```

## Publicar no npm

Entre na sua conta npm:

```bash
npm login
```

Publique o pacote:

```bash
npm publish --access public --otp=CODIGO_2FA
```

## Testar a instalacao publicada

Depois que o pacote aparecer no registro:

```bash
npm uninstall -g openbanjo
npm install -g openbanjo@0.2.0
openbanjo --help
openbanjo
```

Se precisar publicar uma nova versao, atualize as versoes no projeto, crie a
tag correspondente, aguarde os assets no GitHub Releases e publique a mesma
versao no npm.
