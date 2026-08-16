FROM alpine:3.18

WORKDIR /app
COPY . .
RUN ./tools/build-project

CMD ["./tools/run-app"]
