

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

A API sobe em http://localhost:8000 (1 worker), o frontend em http://localhost:5500 e o painel do RabbitMQ em http://localhost:15672 (`segredo` / `bandido123`, ou os valores definidos em `RABBITMQ_USER` e `RABBITMQ_PASS` no `.env`). O SQLite fica no volume `api-data`. Um `.env` na raiz é opcional. Para parar:

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
.venv/bin/python -m scripts.seed
```


```bash
python3 scripts/test_gpio.py
```

### Teste completo da bomba (sem API e sem RabbitMQ)

Executa contagem regressiva (com aceleração em <60s, <20s e <10s), 3 acertos, penalidade, vitória, derrota e desliga todos os componentes ao terminar (duração < 30s):

```bash
python3 -m scripts.test_bomb
```

Para ensaios silenciosos sem som no buzzer, defina `MUTE_BUZZER=1` no ambiente ou no `.env`:

```bash
MUTE_BUZZER=1 python3 -m scripts.test_bomb
```

### Controlador GPIO da bomba

Rodar manualmente em processo separado (não importa `api/`):

```bash
.venv/bin/python -m hardware.controller
```

### Subir automaticamente ao ligar a Raspberry (boot)

Instala os serviços `segredo-stack.service` (RabbitMQ, API com 1 worker e frontend Nginx) e `segredo-gpio.service` (controlador GPIO com reinício automático se cair):

```bash
chmod +x deploy/install.sh deploy/hotspot.sh
bash deploy/install.sh
```

Consultar logs dos serviços:

```bash
docker compose logs -f rabbitmq api frontend
sudo journalctl -u segredo-gpio -f
```

### Plano B de rede (hotspot Wi-Fi da Raspberry)

Caso a rede do laboratório falhe, crie uma rede Wi-Fi própria direto na Raspberry (leva menos de 1 minuto):

1. Ativar o hotspot (SSID padrão `SegredoDoBandido`, senha padrão `bandido123`):
   ```bash
   sudo bash deploy/hotspot.sh on
   ```
2. Conectar os celulares e o computador do administrador no Wi-Fi `SegredoDoBandido`.
3. Abrir o frontend no navegador pelo endereço exibido no comando (`http://10.42.0.1:5500`) ou escanear o QR code na tela Sala do administrador e digitar o código da sala.

Para voltar à rede Wi-Fi normal do laboratório:

```bash
sudo bash deploy/hotspot.sh off
```

Para verificar a rede e o IP ativo a qualquer momento:

```bash
bash deploy/hotspot.sh status
```

Uma branch por issue (nome gerado pelo Linear) e pull request para a `main` com pelo menos 1 revisão.
