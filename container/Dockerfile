FROM python:3.13-alpine

WORKDIR /app
COPY --chown=nobody:nobody server.py /app/server.py

USER nobody
EXPOSE 8080

CMD ["python", "-u", "/app/server.py"]
