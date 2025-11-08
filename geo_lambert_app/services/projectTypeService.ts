// ProjectTypeService - Service pour la gestion des types de projets
import { getStoredCredentials } from "./authService";
import { getCurrentApiUrl } from "./config/configService";
import * as SQLite from 'expo-sqlite';
import { EventEmitter } from 'events';

// Event Emitter pour les mises à jour en temps réel
const projectTypeEventEmitter = new EventEmitter();

// SQLite Database
let db: SQLite.SQLiteDatabase | null = null;

// Initialize Database
const initDatabase = async () => {
    if (db) return db;

    try {
        db = await SQLite.openDatabaseAsync('geo_lambert.db');

        // Create project_types table
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS project_types
            (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);

        console.log('✅ Project types table initialized');
        return db;
    } catch (error) {
        console.error('❌ Error initializing project types table:', error);
        throw error;
    }
};

// ==================== INTERFACES ====================

export interface ProjectType {
    id: number;
    name: string;
    display_name: string;
}

export interface ProjectTypeResponse {
    success: boolean;
    result?: ProjectType[];
    message?: string;
    operation_info?: {
        model: string;
        method: string;
        user: string;
    };
    timestamp?: string;
}

// ==================== SERVICE TYPES DE PROJETS ====================

export const projectTypeService = {
    /**
     * 💾 SAUVEGARDE : Types dans SQLite
     */
    async saveTypesToCache(types: ProjectType[]): Promise<void> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            await database.withTransactionAsync(async () => {
                await database.runAsync('DELETE FROM project_types');

                const timestamp = Date.now();
                for (const type of types) {
                    await database.runAsync(
                        'INSERT INTO project_types (id, data, updated_at) VALUES (?, ?, ?)',
                        [type.id, JSON.stringify(type), timestamp]
                    );
                }
            });

            console.log(`💾 ${types.length} types sauvegardés dans SQLite`);
        } catch (error) {
            console.error('❌ Erreur sauvegarde types SQLite:', error);
        }
    },

    /**
     * 📂 CHARGEMENT : Types depuis SQLite
     */
    async loadTypesFromCache(): Promise<ProjectType[]> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            const rows = await database.getAllAsync<{ id: number; data: string; updated_at: number }>(
                'SELECT id, data, updated_at FROM project_types ORDER BY id'
            );

            if (rows.length === 0) {
                console.log('📂 Aucun type en cache SQLite');
                return [];
            }

            const types = rows.map(row => JSON.parse(row.data) as ProjectType);
            const cacheDate = new Date(rows[0].updated_at);

            console.log(`📂 ${types.length} types chargés depuis SQLite (cache: ${cacheDate.toLocaleString('fr-FR')})`);
            return types;
        } catch (error) {
            console.error('❌ Erreur chargement types SQLite:', error);
            return [];
        }
    },

    /**
     * 🌐 FETCH API : Récupérer les types depuis l'API Odoo
     */
    async fetchTypesFromAPI(): Promise<ProjectType[]> {
        const credentials = await getStoredCredentials();
        if (!credentials) {
            throw new Error('Aucune authentification trouvée');
        }

        const payload = {
            "operation": "rpc",
            "db": credentials.db,
            "username": credentials.username,
            "password": credentials.password,
            "model": "project.type",
            "method": "search_read",
            "kwargs": {
                "domain": [],
                "fields": ["name", "display_name"],
                "order": "name ASC"
            }
        };

        console.log('🌐 Payload récupération types:', JSON.stringify(payload, null, 2));

        const apiUrl = getCurrentApiUrl();
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('📥 Réponse types reçue:', data);

        if (data.success && Array.isArray(data.result)) {
            return data.result;
        } else if (Array.isArray(data)) {
            return data;
        } else {
            throw new Error(`Format de réponse inattendu: ${JSON.stringify(data)}`);
        }
    },

    /**
     * ✅ RÉCUPÉRATION : Tous les types (offline-first)
     */
    async getProjectTypes(): Promise<ProjectTypeResponse> {
        try {
            console.log('📊 Récupération des types de projets (offline-first)...');

            const cachedTypes = await this.loadTypesFromCache();

            if (cachedTypes.length > 0) {
                console.log(`📂 ${cachedTypes.length} types trouvés dans cache SQLite`);

                // Rafraîchir en arrière-plan
                this.refreshTypesInBackground();

                return {
                    success: true,
                    result: cachedTypes,
                    message: 'Données chargées depuis le cache local'
                };
            }

            console.log('📂 Cache SQLite vide, chargement depuis API...');
            const types = await this.fetchTypesFromAPI();

            if (types.length > 0) {
                console.log(`✅ ${types.length} types récupérés depuis API`);

                await this.saveTypesToCache(types);
                console.log('💾 Types sauvegardés dans le cache SQLite');

                return {
                    success: true,
                    result: types
                };
            } else {
                console.warn('⚠️ Aucun type reçu depuis l\'API');
                return {
                    success: false,
                    message: 'Aucun type trouvé',
                    result: []
                };
            }

        } catch (error) {
            console.error('❌ Erreur récupération types:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue',
                result: []
            };
        }
    },

    /**
     * 🔄 REFRESH : Rafraîchir les types depuis l'API en arrière-plan
     */
    async refreshTypesInBackground(): Promise<void> {
        try {
            console.log('🔄 Rafraîchissement types en arrière-plan depuis API...');

            const types = await this.fetchTypesFromAPI();

            if (types.length > 0) {
                console.log(`🔄 ${types.length} types rafraîchis depuis API`);
                await this.saveTypesToCache(types);
                console.log('✅ Cache SQLite types mis à jour en arrière-plan');

                projectTypeEventEmitter.emit('typesUpdated', types);
            }
        } catch (error) {
            console.warn('⚠️ Échec rafraîchissement types en arrière-plan (pas grave):', error);
        }
    },

    /**
     * 🔄 FORCE REFRESH : Forcer le rafraîchissement depuis l'API
     */
    async forceRefreshTypes(): Promise<ProjectTypeResponse> {
        try {
            console.log('🔄 Force refresh types...');
            const types = await this.fetchTypesFromAPI();

            if (types.length > 0) {
                await this.saveTypesToCache(types);
                projectTypeEventEmitter.emit('typesUpdated', types);

                return {
                    success: true,
                    result: types,
                    message: 'Types rafraîchis avec succès'
                };
            } else {
                return {
                    success: false,
                    message: 'Aucun type trouvé'
                };
            }
        } catch (error) {
            console.error('❌ Erreur force refresh types:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    },

    /**
     * 🗑️ CLEAR TYPES : Supprimer tous les types de la base SQLite
     */
    async clearTypes(): Promise<boolean> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            await database.runAsync('DELETE FROM project_types');

            console.log('✅ Tous les types ont été supprimés de SQLite');

            projectTypeEventEmitter.emit('typesCleared');

            return true;

        } catch (error) {
            console.error('❌ Erreur lors de la suppression des types:', error);
            return false;
        }
    }
};

// ==================== EVENT SUBSCRIPTIONS ====================

export const subscribeToTypeUpdates = (callback: (types: ProjectType[]) => void) => {
    projectTypeEventEmitter.on('typesUpdated', callback);
    return () => projectTypeEventEmitter.off('typesUpdated', callback);
};

export const subscribeToTypesCleared = (callback: () => void) => {
    projectTypeEventEmitter.on('typesCleared', callback);
    return () => projectTypeEventEmitter.off('typesCleared', callback);
};

export default projectTypeService;
