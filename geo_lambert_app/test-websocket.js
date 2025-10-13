#!/usr/bin/env node
/**
 * Test script for WebSocket channel message_app_geo_lambert
 * 
 * Usage: node test-websocket.js
 * 
 * This script will send test messages to the message_app_geo_lambert channel
 * to verify that the WebSocket service is working correctly.
 */

const http = require('http');

const WEBSOCKET_SERVER_URL = 'http://localhost:4000';
const TEST_MESSAGES = [
    {
        channel: 'message_app_geo_lambert',
        data: {
            message: 'Test message from script',
            type: 'test',
            timestamp: new Date().toISOString(),
            source: 'test-script'
        }
    },
    {
        channel: 'message_app_geo_lambert', 
        data: {
            message: 'Notification test',
            type: 'notification',
            title: 'Test Notification',
            body: 'This is a test notification for Geo Lambert',
            timestamp: new Date().toISOString()
        }
    },
    {
        channel: 'message_geo_lambert',
        data: {
            message: 'Public channel test',
            type: 'info',
            content: 'Testing public message_geo_lambert channel',
            timestamp: new Date().toISOString()
        }
    },
    {
        channel: 'products',
        data: {
            event_type: 'test',
            id: 999,
            name: 'Test Product',
            message: 'Testing products channel',
            timestamp: new Date().toISOString()
        }
    }
];

function sendMessage(messageData) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(messageData);
        
        const options = {
            hostname: 'localhost',
            port: 4000,
            path: '/websocket',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        console.log(`📤 Sending message to channel: ${messageData.channel}`);
        console.log(`📋 Data:`, messageData.data);
        
        const req = http.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                console.log(`✅ Response (${res.statusCode}):`, responseData);
                resolve(responseData);
            });
        });

        req.on('error', (e) => {
            console.error(`❌ Error sending message:`, e.message);
            reject(e);
        });

        req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log('🚀 Starting WebSocket Channel Tests');
    console.log('🔗 WebSocket Server:', WEBSOCKET_SERVER_URL);
    console.log('📅 Test started at:', new Date().toISOString());
    console.log('=' .repeat(60));
    
    for (let i = 0; i < TEST_MESSAGES.length; i++) {
        const message = TEST_MESSAGES[i];
        
        try {
            console.log(`\n🧪 Test ${i + 1}/${TEST_MESSAGES.length}`);
            await sendMessage(message);
            
            // Wait 2 seconds between messages
            if (i < TEST_MESSAGES.length - 1) {
                console.log('⏳ Waiting 2 seconds...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
        } catch (error) {
            console.error(`❌ Test ${i + 1} failed:`, error.message);
        }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 All tests completed!');
    console.log('📱 Check your React Native app console for received messages');
    console.log('🔍 Look for messages like:');
    console.log('   "🎉 MESSAGE REÇU SUR LE CANAL PUBLIC GEO LAMBERT APP"');
    console.log('   "Alert: ayoub ezzine"');
}

// Check if WebSocket server is running
function checkServer() {
    return new Promise((resolve, reject) => {
        const req = http.get('http://localhost:4000/', (res) => {
            resolve(true);
        });
        
        req.on('error', (e) => {
            reject(new Error('WebSocket server is not running on localhost:4000'));
        });
        
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Server check timeout'));
        });
    });
}

// Main execution
async function main() {
    try {
        console.log('🔍 Checking if WebSocket server is running...');
        await checkServer();
        console.log('✅ WebSocket server is running');
        
        await runTests();
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n💡 Make sure your WebSocket server is running:');
        console.log('   cd path/to/geo_lambert');
        console.log('   node check-connection.js');
        console.log('   Then run this test again.');
    }
}

if (require.main === module) {
    main();
}

module.exports = { sendMessage, runTests };
