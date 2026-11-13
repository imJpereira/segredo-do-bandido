#!/usr/bin/env bash
set -euo pipefail

CON_NAME="segredo-hotspot"
ACTION="${1:-status}"
SSID="${2:-SegredoDoBandido}"
PASSWORD="${3:-bandido123}"

wifi_device() {
  nmcli -t -f DEVICE,TYPE dev status | awk -F: '$2=="wifi"{print $1; exit}'
}

case "$ACTION" in
  on)
    IFACE="$(wifi_device)"
    if [ -z "$IFACE" ]; then
      echo "Nenhuma interface Wi-Fi encontrada."
      exit 1
    fi
    sudo nmcli connection delete "$CON_NAME" >/dev/null 2>&1 || true
    sudo nmcli dev wifi hotspot ifname "$IFACE" con-name "$CON_NAME" ssid "$SSID" password "$PASSWORD"
    IP_ADDR="$(ip -4 -o addr show dev "$IFACE" | awk '{split($4,a,"/"); print a[1]; exit}')"
    IP_ADDR="${IP_ADDR:-10.42.0.1}"
    echo "Hotspot ativo na interface $IFACE"
    echo "SSID: $SSID"
    echo "Senha: $PASSWORD"
    echo "Frontend: http://$IP_ADDR:5500"
    echo "API: http://$IP_ADDR:8000"
    ;;
  off)
    sudo nmcli connection down "$CON_NAME" >/dev/null 2>&1 || true
    sudo nmcli connection delete "$CON_NAME" >/dev/null 2>&1 || true
    sudo nmcli dev wifi rescan >/dev/null 2>&1 || true
    sleep 3
    echo "Hotspot desativado. IPs atuais: $(hostname -I)"
    ;;
  status)
    nmcli -t -f NAME,TYPE,DEVICE connection show --active
    echo "IPs atuais: $(hostname -I)"
    ;;
  *)
    echo "Uso: $0 {on [SSID] [SENHA] | off | status}"
    exit 1
    ;;
esac
