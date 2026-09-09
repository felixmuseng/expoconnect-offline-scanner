#!/usr/bin/env bash
# Lets the desktop user open any USB printer from the browser. Run once per Linux machine.
set -euo pipefail

RULE=/etc/udev/rules.d/99-usb-printer-uaccess.rules

sudo tee "$RULE" >/dev/null <<'EOF'
# uaccess covers the logged-in user; plugdev is the fallback where logind sets no ACL.
SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", ENV{ID_USB_INTERFACES}=="*:07*", TAG+="uaccess", GROUP="plugdev", MODE="0660"
EOF

sudo udevadm control --reload
sudo udevadm trigger --subsystem-match=usb --action=add

# usblp grabs printer interfaces and never lets go, so claimInterface fails in the
# browser. CUPS does not need it — its usb backend talks libusb.
echo 'blacklist usblp' | sudo tee /etc/modprobe.d/blacklist-usblp.conf >/dev/null
sudo modprobe -r usblp 2>/dev/null || echo "usblp is busy; unplug the printer, or reboot."

if ! id -nG | tr ' ' '\n' | grep -qx plugdev; then
  echo "Not in group plugdev: run 'sudo usermod -aG plugdev $USER' and log out once."
fi

echo "Installed $RULE. Replug the printer and reload the page."
