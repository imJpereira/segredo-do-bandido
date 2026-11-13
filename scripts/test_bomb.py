import time

from hardware.bomb import Bomb


def main() -> None:
    print("Starting bomb self-test (all LEDs and buzzer)...")
    with Bomb() as bomb:
        print("[1/7] Countdown > 60s (1.0s tick) + 1st green LED")
        bomb.start(time.time() + 120)
        time.sleep(2.2)
        bomb.hit(1)
        time.sleep(1.0)

        print("[2/7] Countdown < 60s (0.5s tick) + 2nd green LED")
        bomb.set_deadline(time.time() + 45)
        time.sleep(2.0)
        bomb.hit(2)
        time.sleep(0.8)

        print("[3/7] Countdown < 20s (0.25s tick) + penalty (keeps 2 green LEDs)")
        bomb.set_deadline(time.time() + 18)
        time.sleep(1.6)
        bomb.penalty()

        print("[4/7] Countdown < 10s (0.12s tick)")
        bomb.set_deadline(time.time() + 8)
        time.sleep(1.5)

        print("[5/7] 3rd green LED + Win sequence")
        bomb.hit(3)
        time.sleep(0.8)
        bomb.win()
        time.sleep(1.0)

        print("[6/7] New match start (green LEDs reset) + Lose sequence")
        bomb.start(time.time() + 8)
        time.sleep(1.5)
        bomb.lose()
        time.sleep(1.0)

    print("[7/7] Done: all LEDs and buzzer turned off.")


if __name__ == "__main__":
    main()
