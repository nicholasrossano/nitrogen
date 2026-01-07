// seedForYouDomain.js

const admin = require('firebase-admin');
const serviceAccount = require('./ponder-f84ce-firebase-adminsdk-2we9h-2fc1e9be8a.json');

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ─────────── Seed "For You" Domain (doc ID "0") ───────────

async function seedForYouDomain() {
	const docId = '0';

	const data = {
		name: 'For You',
		display: true,
		categoryLabel: 'Personalized feed',
		imageUrl: null,
		categories: [] // For You is cross-domain; no concrete subcategories
	};

	try {
		await db.collection('domains').doc(docId).set(data, { merge: true });
		console.log(`Wrote For You domain with id ${docId}: ${data.name}`);
		process.exit(0);
	} catch (error) {
		console.error('Error seeding For You domain', error);
		process.exit(1);
	}
}

seedForYouDomain();