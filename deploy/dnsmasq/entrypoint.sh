#!/bin/sh
set -eu
mkdir -p /data/tftp /data/dnsmasq /data/diag /data/incoming /data/images /data/profiles /data/projects /data/machines /data/scripts /data/reports
if [ ! -f /data/state.json ]; then
  cp /opt/default-state.json /data/state.json
fi
if [ ! -f /data/dnsmasq/dnsmasq.conf ]; then
  cp /opt/dnsmasq.conf /data/dnsmasq/dnsmasq.conf
fi
if [ ! -f /data/tftp/boot.ipxe ]; then
  cp /opt/boot.ipxe /data/tftp/boot.ipxe
fi
exec dnsmasq -k -C /data/dnsmasq/dnsmasq.conf
