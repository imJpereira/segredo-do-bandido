

Jogo cooperativo de perguntas em tempo real. A turma entra em uma sala pelo navegador do celular, vota nas respostas e a opção mais votada vira a resposta da equipe. Uma Raspberry Pi com LEDs e buzzer faz o papel de bomba: se a equipe errar demais, o tempo acaba e a bomba "explode".

Trabalho da disciplina Computação Distribuída (CCOM6N).



- Cada partida tem 3 perguntas sorteadas do banco, com 4 opções cada.
- Todos os jogadores da sala votam. A opção mais votada é a resposta; empate é decidido por sorteio.
- Erro: o tempo diminui, a opção vencedora é eliminada e a mesma pergunta é votada de novo.
- Vitória: 3 acertos dentro do tempo. Derrota: o tempo chega a zero.
- Nenhum endpoint ou evento revela a opção correta.



| Camada | Tecnologia |
| -- | -- |
| API e engine do jogo | Python, FastAPI (1 processo, 1 worker) |
| Mensageria | RabbitMQ (fila `votes` e exchange `game_events`) |
| Tempo real | WebSocket |
| Banco de dados | SQLite (WAL) |
| Frontend | HTML, CSS e JavaScript puro, sem framework |
| Hardware | Raspberry Pi, `gpiozero`, 3 LEDs verdes, 1 LED vermelho e 1 buzzer |



```
api/        FastAPI, engine do jogo e mensageria (SQLite fica aqui, fora do git)
hardware/   controlador GPIO da bomba (processo separado, não importa api/)
frontend/   interface web estática, servida à parte (consome a API)
seed/       perguntas de exemplo
scripts/    scripts utilitários
deploy/     arquivos de deploy da Raspberry
docs/       documentação (contrato de eventos em docs/events.md)
```



```bash
docker compose up -d --build
```

A API sobe em http://localhost:8000 e o painel do RabbitMQ em http://localhost:15672 (`segredo` / `bandido123`, ou os valores definidos em `RABBITMQ_USER` e `RABBITMQ_PASS` no `.env`). O SQLite fica no volume `api-data`. Um `.env` na raiz é opcional. Para parar:

```bash
docker compose down
```



Requer Python 3.10+.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn api.main:app --reload --env-file .env
```

A API é só REST/WebSocket (não serve HTML). Em outro terminal, sirva o frontend:

```bash
python3 -m http.server 5500 --directory frontend
```
Abra http://localhost:5500: a página de teste mostra `API: ok`.

O controlador da bomba (`hardware/`) é um processo separado e só roda na Raspberry; a API e o frontend rodam sem ele.






```bash
.venv/bin/python scripts/test_rabbitmq.py
```


```bash
python3 scripts/test_gpio.py
```

Uma branch por issue (nome gerado pelo Linear) e pull request para a `main` com pelo menos 1 revisão.
