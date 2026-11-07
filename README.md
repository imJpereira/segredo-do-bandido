# Segredo do Bandido

Jogo cooperativo de perguntas em tempo real. A turma entra em uma sala pelo navegador do celular, vota nas respostas e a opção mais votada vira a resposta da equipe. Uma Raspberry Pi com LEDs e buzzer faz o papel de bomba: se a equipe errar demais, o tempo acaba e a bomba "explode".

Trabalho da disciplina Computação Distribuída (CCOM6N).

## Como funciona

- Cada partida tem 3 perguntas sorteadas do banco, com 4 opções cada.
- Todos os jogadores da sala votam. A opção mais votada é a resposta; empate é decidido por sorteio.
- Erro: o tempo diminui, a opção vencedora é eliminada e a mesma pergunta é votada de novo.
- Vitória: 3 acertos dentro do tempo. Derrota: o tempo chega a zero.
- Nenhum endpoint ou evento revela a opção correta.

## Stack

| Camada | Tecnologia |
| -- | -- |
| API e engine do jogo | Python, FastAPI (1 processo, 1 worker) |
| Mensageria | RabbitMQ (fila `votes` e exchange `game_events`) |
| Tempo real | WebSocket |
| Banco de dados | SQLite (WAL) |
| Frontend | HTML, CSS e JavaScript puro, sem framework |
| Hardware | Raspberry Pi, `gpiozero`, 3 LEDs verdes, 1 LED vermelho e 1 buzzer |

## Estrutura

```
api/        FastAPI, engine do jogo e mensageria
hardware/   controlador GPIO da bomba (processo separado)
frontend/   interface web estática
seed/       perguntas de exemplo
tests/      testes
data/       banco SQLite gerado em execução (fora do git)
```
