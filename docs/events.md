# Contrato de eventos

> RASCUNHO para validação entre João, Bruno, Rodolfo e Winicius. Os campos abaixo são uma proposta inicial; ajustar aqui antes de implementar.

Eventos saem da API pelo WebSocket (frontend) e pela exchange `game_events` (hardware, via fila `events.gpio`).
Todo evento é JSON com o formato:

```json
{ "type": "<nome>", "data": { } }
```

Nenhum evento revela a opção correta.

| type | Quando | `data` |
| -- | -- | -- |
| `lobby_update` | Jogador entra ou sai da sala | `{ "players": ["nome"], "count": 3 }` |
| `game_started` | Partida começa | `{ "total_questions": 3, "time_left": 180 }` |
| `question` | Nova pergunta, ou a mesma após erro | `{ "index": 1, "text": "...", "options": [{"id": "A", "text": "..."}], "eliminated": ["B"] }` |
| `vote_progress` | Voto recebido | `{ "voted": 2, "total": 4 }` |
| `round_result` | Votação encerrada | `{ "winning_option": "A", "correct": true, "time_left": 165 }` |
| `time_penalty` | Erro reduz o tempo | `{ "penalty": 20, "time_left": 145 }` |
| `game_won` | 3 acertos dentro do tempo | `{ "time_left": 40 }` |
| `game_lost` | Tempo chegou a zero | `{ "correct_answers": 1 }` |
