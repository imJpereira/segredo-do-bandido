"""Script de teste dos pinos GPIO da protoboard (BAG-81).

Acende e apaga cada um dos 4 LEDs individualmente (3 verdes e 1 vermelho) e
aciona o buzzer usando a biblioteca gpiozero, liberando todos os pinos ao final.

Ligacao (BCM / pino fisico):
  - LED verde 1  : GPIO 17 (pino 11)
  - LED verde 2  : GPIO 27 (pino 13)
  - LED verde 3  : GPIO 22 (pino 15)
  - LED vermelho : GPIO 23 (pino 16)
  - Buzzer ativo : GPIO 24 (pino 18)
  - GND (terra)  : pino 14

Uso na Raspberry Pi:
    python3 scripts/test_gpio.py
"""

import time

from gpiozero import Buzzer, LED

PINS = [
    ("LED verde 1", 17, 11),
    ("LED verde 2", 27, 13),
    ("LED verde 3", 22, 15),
    ("LED vermelho", 23, 16),
]
BUZZER_BCM = 24
BUZZER_BOARD_PIN = 18


def main() -> None:
    leds = [(name, bcm, board_pin, LED(bcm)) for name, bcm, board_pin in PINS]
    buzzer = Buzzer(BUZZER_BCM)

    try:
        print("=== Iniciando teste de GPIO (gpiozero) ===")

        for _, _, _, led in leds:
            led.off()
        buzzer.off()

        for name, bcm, board_pin, led in leds:
            print(f"[TESTE] Acendendo {name} (GPIO {bcm} / pino fisico {board_pin})...")
            led.on()
            time.sleep(0.8)
            led.off()
            print(f"[OK] {name} apagado.")
            time.sleep(0.3)

        print(f"[TESTE] Acionando Buzzer (GPIO {BUZZER_BCM} / pino fisico {BUZZER_BOARD_PIN})...")
        buzzer.on()
        time.sleep(0.4)
        buzzer.off()
        print("[OK] Buzzer desligado.")
        time.sleep(0.3)

        print("[TESTE] Acendendo todos os LEDs simultaneamente e dando 2 bipes curtos...")
        for _, _, _, led in leds:
            led.on()
        for _ in range(2):
            buzzer.on()
            time.sleep(0.15)
            buzzer.off()
            time.sleep(0.15)
        time.sleep(0.5)

        print("=== Teste de GPIO concluido com sucesso! ===")
    finally:
        for _, _, _, led in leds:
            led.off()
            led.close()
        buzzer.off()
        buzzer.close()
        print("Todos os componentes desligados e pinos GPIO liberados.")


if __name__ == "__main__":
    main()
