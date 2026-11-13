import threading
import time

from gpiozero import Buzzer, LED

GREEN_PINS = (17, 27, 22)
RED_PIN = 23
BUZZER_PIN = 24


class Bomb:
    def __init__(self) -> None:
        self._green_leds = [LED(pin) for pin in GREEN_PINS]
        self._red_led = LED(RED_PIN)
        self._buzzer = Buzzer(BUZZER_PIN)
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._deadline: float | None = None
        self.reset()

    def __enter__(self) -> "Bomb":
        return self

    def __exit__(self, *_) -> None:
        self.close()

    def _stop_ticker(self) -> None:
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None

    def _tick_interval(self) -> float:
        if self._deadline is None:
            return 1.0
        remaining = self._deadline - time.time()
        if remaining < 10:
            return 0.12
        if remaining < 20:
            return 0.25
        if remaining < 60:
            return 0.5
        return 1.0

    def _run_ticker(self) -> None:
        while not self._stop_event.is_set():
            interval = self._tick_interval()
            with self._lock:
                if self._stop_event.is_set():
                    break
                self._red_led.on()
                self._buzzer.on()
            if self._stop_event.wait(0.06):
                break
            with self._lock:
                self._red_led.off()
                self._buzzer.off()
            wait_time = max(0.05, interval - 0.06)
            if self._stop_event.wait(wait_time):
                break

    def reset(self) -> None:
        self._stop_ticker()
        self._deadline = None
        with self._lock:
            for led in self._green_leds:
                led.off()
            self._red_led.off()
            self._buzzer.off()

    def start(self, deadline: float) -> None:
        self.reset()
        self._deadline = deadline
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_ticker, daemon=True)
        self._thread.start()

    def set_deadline(self, deadline: float) -> None:
        self._deadline = deadline

    def hit(self, count: int) -> None:
        lit = max(0, min(count, len(self._green_leds)))
        with self._lock:
            for index, led in enumerate(self._green_leds):
                if index < lit:
                    led.on()
                else:
                    led.off()
            self._buzzer.on()
            time.sleep(0.12)
            self._buzzer.off()

    def penalty(self) -> None:
        with self._lock:
            self._buzzer.on()
            for _ in range(4):
                self._red_led.on()
                time.sleep(0.12)
                self._red_led.off()
                time.sleep(0.12)
            self._buzzer.off()

    def win(self) -> None:
        self._stop_ticker()
        with self._lock:
            self._red_led.off()
            self._buzzer.off()
            for _ in range(3):
                for led in self._green_leds:
                    led.on()
                self._buzzer.on()
                time.sleep(0.15)
                for led in self._green_leds:
                    led.off()
                self._buzzer.off()
                time.sleep(0.15)
            for led in self._green_leds:
                led.on()

    def lose(self) -> None:
        self._stop_ticker()
        with self._lock:
            for led in self._green_leds:
                led.off()
            self._red_led.on()
            self._buzzer.on()
            time.sleep(2.0)
            self._buzzer.off()

    def close(self) -> None:
        self.reset()
        for led in self._green_leds:
            led.close()
        self._red_led.close()
        self._buzzer.close()
