# Claude Code Real-Provider E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker-based E2E environment that runs Claude Code CLI through the gateway and uses real provider API keys from `.env`, while skipping missing providers explicitly.

**Architecture:** Generate a runtime E2E gateway config from `.env`, mount a dedicated Claude Code home into the Claude container, and drive provider-aware E2E tests from a shared provider matrix. Real provider requests are opt-in per configured key and skipped otherwise.

**Tech Stack:** Docker Compose, Bash lifecycle scripts, TypeScript helpers, Vitest E2E and unit tests

---
