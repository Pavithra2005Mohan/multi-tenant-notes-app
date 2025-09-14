const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const dbPath = path.resolve(__dirname, 'db.json');
const JWT_SECRET = 'your-super-secret-key-for-jwt';

// Helper to read/write from the JSON database file
const readDb = () => JSON.parse(fs.readFileSync(dbPath));
const writeDb = (data) => fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

// Main handler for all API requests
module.exports = async (req, res) => {
    // Set CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    // Handle pre-flight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Simple routing based on URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const endpoint = url.pathname;

    if (endpoint === '/api/login') {
        // --- LOGIN LOGIC ---
        const { email, password } = req.body;
        const db = readDb();
        const user = db.users.find(u => u.email === email && u.password === password); // Plain text password for demo

        if (user) {
            const tenant = db.tenants.find(t => t.slug === user.tenant);
            const token = jwt.sign({ email: user.email, tenant: user.tenant, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
            return res.status(200).json({ 
                token, 
                user: { email: user.email, role: user.role, tenant: user.tenant, tenantPlan: tenant.plan } 
            });
        }
        return res.status(401).json({ error: 'Invalid credentials' });

    } else {
        // --- PROTECTED ROUTES ---
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (error) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        
        const { tenant, role, email } = decoded;
        
        if (endpoint === '/api/notes') {
            const db = readDb();
            const tenantNotes = db.notes.filter(n => n.tenant === tenant);

            if (req.method === 'GET') {
                return res.status(200).json(tenantNotes);
            }
            if (req.method === 'POST') {
                const tenantInfo = db.tenants.find(t => t.slug === tenant);
                if (tenantInfo.plan === 'FREE' && tenantNotes.length >= 3) {
                    return res.status(403).json({ error: 'Note limit reached' });
                }
                const newNote = { id: Date.now(), author: email, tenant, ...req.body };
                db.notes.push(newNote);
                writeDb(db);
                return res.status(201).json(newNote);
            }
        }
        
        if (endpoint.startsWith('/api/notes/')) {
            if (req.method === 'DELETE') {
                const id = parseInt(endpoint.split('/')[3]);
                let db = readDb();
                const noteIndex = db.notes.findIndex(n => n.id === id && n.tenant === tenant);
                if (noteIndex > -1) {
                    db.notes.splice(noteIndex, 1);
                    writeDb(db);
                    return res.status(204).end();
                }
                return res.status(404).json({ error: 'Note not found' });
            }
        }

        if (endpoint === '/api/tenants/upgrade') {
            if (role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
            let db = readDb();
            const tenantIndex = db.tenants.findIndex(t => t.slug === tenant);
            if (tenantIndex > -1) {
                db.tenants[tenantIndex].plan = 'PRO';
                writeDb(db);
                return res.status(200).json(db.tenants[tenantIndex]);
            }
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        if(endpoint === '/api/users') {
            if (role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
            const db = readDb();
            const tenantUsers = db.users.filter(u => u.tenant === tenant);
            return res.status(200).json(tenantUsers);
        }
        
        if(endpoint === '/api/users/role') {
            if (role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
            const { email: userEmailToUpdate, role: newRole } = req.body;
            let db = readDb();
            const userIndex = db.users.findIndex(u => u.email === userEmailToUpdate && u.tenant === tenant);
            if (userIndex > -1) {
                db.users[userIndex].role = newRole;
                writeDb(db);
                return res.status(200).json(db.users[userIndex]);
            }
            return res.status(404).json({ error: 'User not found in your tenant' });
        }
    }
    
    return res.status(404).json({ error: 'Not Found' });
};