#!/usr/bin/env bash
# Lets the desktop user open any USB printer from the browser. Run once per Linux machine.
set -euo pipefail

RULE=/etc/udev/rules.d/99-usb-printer-uaccess.rules

sudo tee "$RULE" >/dev/null <<'EOF'
SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", ENV{ID_USB_INTERFACES}=="*:07*", TAG+="uaccess"
EOF

sudo udevadm control --reload
sudo udevadm trigger --subsystem-match=usb --action=add

echo "Installed $RULE. Replug the printer and reload the page."
