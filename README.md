# Chamas Main

App principal do Chamas RPG para rodar separado no Shard.

## Responsabilidade

- login e cadastro;
- For You;
- perfis;
- campanhas;
- minhas fichas;
- configuracoes da conta;
- ferramentas, incluindo link para o Mixer.

O Mixer nao roda dentro deste app. Ele e aberto pela variavel:

```env
MIXER_PUBLIC_URL=https://chamas-mixer.shardweb.app
```

## Rodar local

```bash
python -m pip install -r requirements.txt
python main.py
```

## Deploy no Shard

Crie um app separado, por exemplo `chamas-main`, apontando para esta pasta.

Comando:

```bash
python main.py
```

Variaveis principais:

```env
PUBLIC_MAIN_URL=https://chamas-main.shardweb.app
MIXER_PUBLIC_URL=https://chamas-mixer.shardweb.app
DASHBOARD_KEY=uma_senha_grande
FIRST_USER_ROLE=developer
```
