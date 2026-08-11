# Ops Request Hub

**BDT × CSP Service Desk**

Ops Request Hub is an internal operational request management portal where BDT staff submit service requests and CSP staff receive, process, and update them.

## Current stage

This repository currently contains the **frontend prototype / UI foundation**. It is a responsive static application built with HTML, CSS, and vanilla JavaScript. All requests, users, filters, statuses, and queue actions use local demonstration data only.

Open `index.html` directly in a browser or serve the repository as a static GitHub Pages site. There is no build step and no package installation.

## Prototype features

- Responsive dashboard with operational status summaries
- Dynamic request form fields based on request type
- Demo My Requests and Team Requests views with client-side filters
- CSP queue preview with local Take, Complete, and Unable interactions
- Request detail modal and clipboard copy controls
- Mobile navigation and accessible form labels and controls

## Planned architecture

Later project stages are expected to use:

- GitHub Pages for the frontend
- Cloudflare Worker for the API and security layer
- Google Apps Script and Google Sheets for backend workflows and storage

Backend integration is intentionally **not included** in this first build. The prototype makes no API requests, saves no request data, and contains no real authentication or credentials.
