"""Loaded before any test. Forces the mock worker so a test run can never reach the property's site."""
import os

os.environ["WORKER"] = "mock"
