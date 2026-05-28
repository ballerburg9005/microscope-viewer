#!/usr/bin/env bash
set -euo pipefail

RULE_FILE="/etc/udev/rules.d/99-geek-szitman-supercamera.rules"
USER_NAME="${SUDO_USER:-$USER}"

cat > "$RULE_FILE" <<RULE
# Geek Szitman supercamera / non-UVC USB microscope.
SUBSYSTEM=="usb", ATTR{idVendor}=="0329", ATTR{idProduct}=="2022", MODE="0660", GROUP="plugdev", TAG+="uaccess"
SUBSYSTEM=="usb", ATTR{idVendor}=="2ce3", ATTR{idProduct}=="3828", MODE="0660", GROUP="plugdev", TAG+="uaccess"
RULE

if getent group plugdev >/dev/null; then
  usermod -aG plugdev "$USER_NAME"
fi

udevadm control --reload-rules
udevadm trigger

echo "Installed $RULE_FILE"
echo "Unplug and reconnect the microscope. You may need to log out and back in for group membership changes."
