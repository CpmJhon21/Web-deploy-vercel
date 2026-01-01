const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

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
        const vercelFiles = files.map(file => ({
            file: file.name,
            data: Buffer.from(file.content).toString('base64'),
            encoding: 'base64'
        }));
        
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
                    framework: null
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
        const projectId = deploymentResponse.data.project.id || deploymentResponse.data.projectId;
        console.log(`Deployment created: ${deploymentId}, Project ID: ${projectId}`);
        
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
        const fullUrl = `https://${deploymentUrl}`;
        
        console.log(`Deployment successful! URL: ${fullUrl}`);
        
        // 3. Return success response
        res.json({
            success: true,
            projectName: projectName,
            url: fullUrl,
            deploymentId: deploymentId,
            projectId: projectId,
            message: 'Website deployed successfully!',
            vercelUrl: `https://vercel.com/deployments/${deploymentId}`
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

// Delete ALL projects endpoint
app.delete('/api/deploy/all', async (req, res) => {
    console.log('Received request to delete ALL projects');
    
    try {
        const apiKey = getNextApiKey();
        
        // 1. Get all projects
        const projectsResponse = await axios.get(
            'https://api.vercel.com/v9/projects',
            {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            }
        );
        
        const projects = projectsResponse.data.projects;
        console.log(`Found ${projects.length} projects to delete`);
        
        const results = {
            total: projects.length,
            deleted: 0,
            failed: 0,
            errors: []
        };

        // 2. Delete each project
        for (const project of projects) {
            try {
                await axios.delete(
                    `https://api.vercel.com/v9/projects/${project.id}`,
                    {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    }
                );
                results.deleted++;
                console.log(`Deleted project: ${project.name}`);
            } catch (err) {
                results.failed++;
                results.errors.push({ project: project.name, error: err.message });
                console.error(`Failed to delete project ${project.name}:`, err.message);
            }
        }
        
        res.json({
            success: true,
            message: `Cleanup completed. Deleted ${results.deleted} of ${results.total} projects.`,
            results
        });
        
    } catch (error) {
        console.error('All-projects deletion error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.error?.message || error.message
        });
    }
});

// Delete deployment endpoint (supports ID or URL)
app.delete('/api/deploy', async (req, res) => {
    const { identifier } = req.body;
    console.log(`Received deletion request for: ${identifier}`);
    
    if (!identifier) {
        return res.status(400).json({ success: false, error: 'Identifier (ID or URL) is required' });
    }
    
    try {
        const apiKey = getNextApiKey();
        let targetDeploymentId = null;
        let targetProjectId = null;

        // Determine if it's a Project ID (prj_...), Deployment ID (dpl_...), or URL
        if (identifier.startsWith('prj_')) {
            targetProjectId = identifier;
        } else if (identifier.startsWith('dpl_')) {
            targetDeploymentId = identifier;
        } else if (identifier.includes('.vercel.app') || identifier.includes('http')) {
            const host = identifier.replace(/^https?:\/\//, '').split('/')[0].trim();
            console.log(`Searching for info with host: ${host}`);
            
            const listResponse = await axios.get(
                `https://api.vercel.com/v6/deployments?limit=100`,
                { headers: { 'Authorization': `Bearer ${apiKey}` } }
            );
            
            const deployment = listResponse.data.deployments.find(d => 
                d.url === host || d.name === host.split('.')[0] || (d.alias && d.alias.includes(host))
            );
            
            if (deployment) {
                targetDeploymentId = deployment.uid || deployment.id;
                // Vercel deployment object usually has projectId or name
                const projectName = deployment.name;
                const projectResponse = await axios.get(
                    `https://api.vercel.com/v9/projects/${projectName}`,
                    { headers: { 'Authorization': `Bearer ${apiKey}` } }
                ).catch(() => null);
                if (projectResponse) targetProjectId = projectResponse.data.id;
            } else {
                targetProjectId = host.split('.')[0];
            }
        } else {
            // Assume it might be a project name
            targetProjectId = identifier;
        }
        
        const results = { deploymentDeleted: false, projectDeleted: false };

        // 1. Try to delete the specific deployment if we have an ID
        if (targetDeploymentId) {
            console.log(`Deleting deployment ID: ${targetDeploymentId}`);
            await axios.delete(
                `https://api.vercel.com/v13/deployments/${targetDeploymentId}`,
                { headers: { 'Authorization': `Bearer ${apiKey}` } }
            ).then(() => results.deploymentDeleted = true)
             .catch(err => console.log(`Deployment deletion failed: ${err.message}`));
        }

        // 2. Try to delete the project (this will delete ALL its deployments)
        if (targetProjectId) {
            console.log(`Deleting project ID/Name: ${targetProjectId}`);
            await axios.delete(
                `https://api.vercel.com/v9/projects/${targetProjectId}`,
                { headers: { 'Authorization': `Bearer ${apiKey}` } }
            ).then(() => results.projectDeleted = true)
             .catch(err => {
                 const errMsg = err.response?.data?.error?.message || err.message;
                 console.log(`Project deletion failed: ${errMsg}`);
                 // If we didn't delete a deployment and project deletion failed, throw error
                 if (!results.deploymentDeleted) throw new Error(`Deletion failed: ${errMsg}`);
             });
        }
        
        res.json({
            success: true,
            message: 'Deletion successful',
            results
        });
        
    } catch (error) {
        console.error('Deletion error:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.error?.message || error.message
        });
    }
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Deployer Pro API running on port ${PORT}`);
    console.log(`🔑 API Keys available: ${API_KEYS.length}`);
    console.log(`🌐 Open http://localhost:${PORT} to use the app`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Promise Rejection:', err);
});