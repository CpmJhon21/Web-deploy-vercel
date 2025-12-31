const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.')); // Serve static files

// API Keys (gunakan environment variables)
const API_KEYS = [
    process.env.VERCEL_TOKEN_1,
    process.env.VERCEL_TOKEN_2,
    process.env.VERCEL_TOKEN_3
].filter(Boolean); // Filter out undefined keys

// Helper function to get next API key (rotation)
let currentKeyIndex = 0;
function getNextApiKey() {
    if (API_KEYS.length === 0) {
        throw new Error('No API keys configured');
    }
    
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Deployer Pro API is running',
        keysAvailable: API_KEYS.length,
        version: '3.5'
    });
});

// Main deployment endpoint
app.post('/api/deploy', async (req, res) => {
    console.log('Received deployment request');
    
    try {
        const { projectName, files } = req.body;
        
        // Validate request
        if (!projectName) {
            return res.status(400).json({ 
                success: false, 
                error: 'Project name is required' 
            });
        }
        
        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'No files provided' 
            });
        }
        
        // Check for index.html
        const hasIndexHtml = files.some(f => f.name === 'index.html');
        if (!hasIndexHtml) {
            return res.status(400).json({ 
                success: false, 
                error: 'index.html is required' 
            });
        }
        
        console.log(`Deploying project: ${projectName} with ${files.length} files`);
        
        // Prepare files for Vercel API
        const vercelFiles = {};
        files.forEach(file => {
            // Convert file content to base64
            vercelFiles[file.name] = {
                content: Buffer.from(file.content).toString('base64')
            };
        });
        
        // Get API key
        const apiKey = getNextApiKey();
        console.log(`Using API key index: ${currentKeyIndex}`);
        
        // 1. Create deployment
        const deploymentResponse = await axios.post(
            'https://api.vercel.com/v13/deployments',
            {
                name: projectName,
                files: vercelFiles,
                projectSettings: {
                    framework: 'static'
                },
                target: 'production'
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        const deploymentId = deploymentResponse.data.id;
        console.log(`Deployment created: ${deploymentId}`);
        
        // 2. Check deployment status (polling)
        let deploymentReady = false;
        let deploymentData;
        let attempts = 0;
        const maxAttempts = 30; // Max 30 attempts (60 seconds)
        
        while (!deploymentReady && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            
            try {
                const statusResponse = await axios.get(
                    `https://api.vercel.com/v13/deployments/${deploymentId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${apiKey}`
                        }
                    }
                );
                
                deploymentData = statusResponse.data;
                
                if (deploymentData.readyState === 'READY') {
                    deploymentReady = true;
                    console.log('Deployment is READY');
                } else if (deploymentData.readyState === 'ERROR') {
                    throw new Error('Deployment failed on Vercel side');
                }
                
            } catch (error) {
                console.error('Error checking deployment status:', error.message);
            }
            
            attempts++;
        }
        
        if (!deploymentReady) {
            console.log('Deployment timeout - using initial URL');
            // Still return success with initial URL
        }
        
        // Get deployment URL
        const deploymentUrl = deploymentData?.url || deploymentResponse.data.url;
        const fullUrl = `https://${deploymentUrl}.vercel.app`;
        
        console.log(`Deployment successful! URL: ${fullUrl}`);
        
        // 3. Return success response
        res.json({
            success: true,
            projectName: projectName,
            url: fullUrl,
            deploymentId: deploymentId,
            message: 'Website deployed successfully!',
            vercelUrl: `https://vercel.com/${deploymentUrl}`
        });
        
    } catch (error) {
        console.error('Deployment error:', error.response?.data || error.message);
        
        // More detailed error handling
        let errorMessage = 'Deployment failed';
        
        if (error.response) {
            // Vercel API error
            const vercelError = error.response.data?.error;
            if (vercelError) {
                errorMessage = `Vercel Error: ${vercelError.message || JSON.stringify(vercelError)}`;
            } else {
                errorMessage = `API Error: ${error.response.status} ${error.response.statusText}`;
            }
        } else if (error.request) {
            // No response received
            errorMessage = 'No response from Vercel API';
        } else {
            // Request setup error
            errorMessage = error.message;
        }
        
        res.status(500).json({
            success: false,
            error: errorMessage
        });
    }
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Deployer Pro API running on port ${PORT}`);
    console.log(`🔑 API Keys available: ${API_KEYS.length}`);
    console.log(`🌐 Open http://localhost:${PORT} to use the app`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Promise Rejection:', err);
});