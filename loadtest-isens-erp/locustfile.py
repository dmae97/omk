import os
import random
from locust import HttpUser, task, between, events

TARGET_URL = os.getenv("TARGET_URL", "https://isens-erp.vercel.app")
PROXY_URL = os.getenv("PROXY_URL", "")

class IsensERPUser(HttpUser):
    wait_time = between(1, 3)
    host = TARGET_URL

    def on_start(self):
        self.client.proxies = {"http": PROXY_URL, "https": PROXY_URL} if PROXY_URL else None

    @task(3)
    def homepage(self):
        with self.client.get("/", catch_response=True) as res:
            if res.status_code == 200:
                res.success()
            else:
                res.failure(f"status {res.status_code}")

    @task(1)
    def slow_page(self):
        self.client.get("/")

@events.request.add_listener
def on_request(request_type, name, response_time, response_length, response, context, exception, **kwargs):
    if exception:
        print(f"[ERR] {request_type} {name} failed: {exception}")
