# syntax=docker/dockerfile:1

FROM golang:1.24-alpine AS build

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -tags osusergo,netgo -o /server

FROM alpine
COPY --from=build /server /server
EXPOSE 8080

CMD ["/server", "8080"]
