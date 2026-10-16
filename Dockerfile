FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services ./services
COPY static ./static
ENV PYTHONUNBUFFERED=1
# APP is the module to serve, e.g. dog_service. ddtrace-run auto-instruments Flask + requests.
CMD ddtrace-run gunicorn --chdir services --bind 0.0.0.0:5000 --worker-class gthread --threads 16 "${APP}:app"
