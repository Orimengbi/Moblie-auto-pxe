FROM alpine:3.20
RUN apk add --no-cache dnsmasq
COPY entrypoint.sh /entrypoint.sh
COPY dnsmasq.default.conf /opt/dnsmasq.conf
COPY boot.default.ipxe /opt/boot.ipxe
COPY state.default.json /opt/default-state.json
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
