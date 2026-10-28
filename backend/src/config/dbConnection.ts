import mongoose from "mongoose";
import dotenv from 'dotenv';

import dns from 'node:dns';
dotenv.config()

const uri = process.env.MONGO_DB as string

const dbConnection = async (): Promise<void> => {
    if (!uri) {
        dns.setServers(['8.8.8.8', '1.1.1.1']);
        console.error('❌ MongoDB URI not found in environment variables');
        console.error('Please set MONGODB_URI or MONGO_URI in your .env file');
        process.exit(1);
    }
    console.log('🔍 Checking MongoDB URI...');
    console.log('URI starts with:', uri.substring(0, 20) + '...');

    console.log('🔄 Connecting to MongoDB...');
    try {
        const connect = await mongoose.connect(uri)

        console.log(`✅ MongoDB Connected: ${connect.connection.host}`);
        console.log(`📊 Database: ${connect.connection.name}`);
    } catch (error: any) {
        console.error('❌ Database connection error:', error.message);
        console.error('Error code:', error.code);
        console.error('Error name:', error.name);

        if (error.code === 'ESERVFAIL') {
            console.error('\n💡 DNS Resolution Error - Possible solutions:');
            console.error('1. Check your internet connection');
            console.error('2. Verify your MongoDB Atlas cluster is running (not paused)');
            console.error('3. Check if your IP is whitelisted in MongoDB Atlas');
            console.error('4. Try using a direct connection string instead of SRV');
            console.error('5. Check firewall/network settings');
        }

    }
}

export default dbConnection;