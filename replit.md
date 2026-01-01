# Vercel Deployer Pro

## Overview
A web application that allows users to deploy static websites to Vercel. Users can upload their website files (HTML, CSS, JS, etc.) and the app will deploy them to Vercel using the Vercel API.

## Project Structure
- `server.js` - Express.js backend server that handles file uploads and Vercel API integration
- `index.html` - Frontend UI for the deployment tool

## Tech Stack
- Node.js 20
- Express.js for backend
- Vanilla JavaScript frontend
- Vercel API for deployments

## Running the App
The app runs on port 5000. Start with:
```bash
node server.js
```

## Environment Variables
The application uses the following environment variables:
- `PORT` - Server port (default: 5000)
- `VERCEL_TOKEN_1`, `VERCEL_TOKEN_2`, `VERCEL_TOKEN_3` - Vercel API tokens for deployment (optional, supports key rotation)

## Features
- Upload multiple files for deployment
- Automatic deployment to Vercel
- Real-time deployment status in terminal UI
- Supports static site hosting
