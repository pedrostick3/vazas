# Vazas

Jogo de cartas de apostas para 3 a 10 jogadores. Em cada ronda dizes quantas vazas vais fazer: se acertares ganhas 10 + as vazas feitas, se falhares ficas a zero.

**Jogar:** https://pedrostick3.github.io/vazas/

## Modos

- **Sozinho:** tu contra 2 a 9 bots (Fácil, Normal ou Difícil).
- **Um telemóvel:** 2 a 10 pessoas no mesmo aparelho, mais bots. Na vez de cada pessoa aparece o ecrã "Passa o telemóvel a…" e a mesa roda até ela ficar em baixo.
- **Online:** salas com código só funcionam na versão alojada no claude.ai (usam a base de dados do artifact). No GitHub Pages este modo fica desativado.

## Regras (resumo)

- Baralho de 40 cartas (sem 10, 9 e 8). Ordem: Ás > 7 > Rei > Valete > Dama > 6 > 5 > 4 > 3 > 2.
- Rondas de 1 a 7 cartas. Depois de dar, vira-se uma carta: o naipe dela é o trunfo.
- Apostas pela ordem do jogo, a começar no jogador seguinte ao dador; o dador aposta em último.
- É obrigatório assistir ao naipe da primeira carta, mesmo tendo trunfo. Ganha o trunfo mais alto; sem trunfos, a carta mais alta do naipe de saída.
- Variantes no menu: baralho completo (10, 9 e 8), dar as cartas todas (o trunfo é a última carta dada), ida e volta, regra do dador, trunfo por rotação, obrigatório cortar.

O GDD completo está em https://claude.ai/code/artifact/d7636729-1456-44d6-976c-5627aaa9f737

## Estrutura

```
index.html            jogo pronto a servir (gerado)
src/engine.js         motor de regras e IA (sem DOM)
src/ui.js             interface e animações (anime.js 3.2.2 via cdnjs)
src/template.html     HTML + CSS
tools/build.py        gera o index.html a partir de src/
tests/engine.test.js  testes e simulação do motor (node tests/engine.test.js)
```

Depois de alterar algo em `src/`, corre `python3 tools/build.py` e faz commit do `index.html`.

## Publicar no GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch: **main** / **(root)** → Save. Ao fim de um minuto o jogo fica em https://pedrostick3.github.io/vazas/.
