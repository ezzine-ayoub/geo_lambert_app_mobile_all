// ExpenseCategoryService - Service pour la gestion des catégories de dépenses
import {
    getStoredCredentials
} from "./authService";
import {
    getCurrentApiUrl
} from "./config/configService";
import * as SQLite from 'expo-sqlite';

// SQLite Database
let db: SQLite.SQLiteDatabase | null = null;

// Initialize Database
const initDatabase = async () => {
    if (db) return db;

    try {
        db = await SQLite.openDatabaseAsync('geo_lambert.db');

        // Create expense_categories table
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS expense_categories
            (
                id
                INTEGER
                PRIMARY
                KEY,
                data
                TEXT
                NOT
                NULL,
                updated_at
                INTEGER
                NOT
                NULL
            );
        `);

        console.log('✅ Expense categories table initialized');
        return db;
    } catch (error) {
        console.error('❌ Error initializing expense categories table:', error);
        throw error;
    }
};

// ==================== INTERFACES ====================

export interface ExpenseType {
    id: number;
    name: string;
    display_name: string;
    create_date: string;
    write_date: string;
    active: boolean;
}

export interface ExpenseCategory {
    id: number;
    name: string;
    code: string;
    expense_type_ids?: ExpenseType[]; // ✅ Optionnel pour éviter les erreurs si undefined
}

export interface ExpenseCategoryResponse {
    success: boolean;
    result?: ExpenseCategory[];
    message?: string;
    operation_info?: {
        model: string;
        method: string;
        user: string;
    };
    timestamp?: string;
}

// ==================== SERVICE CATÉGORIES DE DÉPENSES ====================

export const expenseCategoryService = {
    /**
     * 💾 SAUVEGARDE : Catégories dans SQLite
     */
    async saveCategoriesToCache(categories: ExpenseCategory[]): Promise<void> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            // Clear old data
            await database.runAsync('DELETE FROM expense_categories');

            // Save each category
            const timestamp = Date.now();
            for (const category of categories) {
                await database.runAsync(
                    'INSERT INTO expense_categories (id, data, updated_at) VALUES (?, ?, ?)',
                    [category.id, JSON.stringify(category), timestamp]
                );
            }

            console.log(`💾 ${categories.length} catégories sauvegardées dans SQLite`);
        } catch (error) {
            console.error('❌ Erreur sauvegarde catégories SQLite:', error);
        }
    },

    /**
     * 📂 CHARGEMENT : Catégories depuis SQLite
     */
    async loadCategoriesFromCache(): Promise<ExpenseCategory[]> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            const rows = await database.getAllAsync<{ id: number; data: string; updated_at: number }>(
                'SELECT id, data, updated_at FROM expense_categories ORDER BY id'
            );

            if (rows.length === 0) {
                console.log('📂 Aucune catégorie en cache SQLite');
                return [];
            }

            const categories = rows.map(row => JSON.parse(row.data) as ExpenseCategory);
            const cacheDate = new Date(rows[0].updated_at);

            console.log(`📂 ${categories.length} catégories chargées depuis SQLite (cache: ${cacheDate.toLocaleString('fr-FR')})`);
            return categories;
        } catch (error) {
            console.error('❌ Erreur chargement catégories SQLite:', error);
            return [];
        }
    },

    /**
     * ✅ RÉCUPÉRATION : Toutes les catégories (avec cache SQLite offline-first)
     * ⚠️ Si cache vide : charge TOUJOURS depuis l'API (pas de retour vide)
     */
    async getExpenseCategories(): Promise<ExpenseCategoryResponse> {
        try {
            console.log('📊 Récupération des catégories de dépenses (offline-first)...');

            // 1. TOUJOURS essayer de charger depuis SQLite d'abord
            const cachedCategories = await this.loadCategoriesFromCache();

            if (cachedCategories.length > 0) {
                console.log(`📂 ${cachedCategories.length} catégories trouvées dans cache SQLite`);

                // Rafraîchir depuis l'API en arrière-plan (fire and forget)
                this.refreshCategoriesInBackground();

                // Retourner immédiatement les données en cache
                return {
                    success: true,
                    result: cachedCategories,
                    message: 'Données chargées depuis le cache local'
                };
            }

            // 2. ✅ Si cache vide, charger depuis l'API et ATTENDRE la réponse
            console.log('📂 Cache SQLite vide, chargement depuis API...');
            console.log('⏳ Attente de la réponse API...');

            const categories = await this.fetchCategoriesFromAPI();

            if (categories.length > 0) {
                console.log(`✅ ${categories.length} catégories récupérées depuis API`);

                // ✅ Sauvegarder immédiatement dans le cache
                await this.saveCategoriesToCache(categories);
                console.log('💾 Catégories sauvegardées dans le cache SQLite');

                return {
                    success: true,
                    result: categories
                };
            } else {
                console.warn('⚠️ Aucune catégorie reçue depuis l\'API');
                return {
                    success: false,
                    message: 'Aucune catégorie trouvée',
                    result: []
                };
            }

        } catch (error) {
            console.error('❌ Erreur récupération catégories:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue',
                result: []
            };
        }
    },

    /**
     * 🔄 REFRESH : Rafraîchir les catégories depuis l'API en arrière-plan
     */
    async refreshCategoriesInBackground(): Promise<void> {
        try {
            console.log('🔄 Rafraîchissement catégories en arrière-plan depuis API...');

            const categories = await this.fetchCategoriesFromAPI();

            if (categories.length > 0) {
                console.log(`🔄 ${categories.length} catégories rafraîchies depuis API`);
                await this.saveCategoriesToCache(categories);
                console.log('✅ Cache SQLite catégories mis à jour en arrière-plan');
            }
        } catch (error) {
            console.warn('⚠️ Échec rafraîchissement catégories en arrière-plan (pas grave):', error);
        }
    },

    /**
     * 🌐 FETCH API : Récupérer les catégories depuis l'API Odoo
     */
    async fetchCategoriesFromAPI(): Promise<ExpenseCategory[]> {
        const credentials = await getStoredCredentials();
        if (!credentials) {
            throw new Error('Aucune authentification trouvée');
        }

        const payload = {
            "operation": "rpc",
            "db": credentials.db,
            "username": credentials.username,
            "password": credentials.password,
            "model": "expense.category",
            "method": "search_read",
            "kwargs": {
                "domain": [],
                "fields": ["name", "code", "expense_type_ids"],
                "replaceToObject": [
                    {
                        "expense_type_ids": {
                            "expense.type": [
                                "name", "display_name", "create_date", "write_date", "active"
                            ]
                        }
                    }
                ]
            }
        }

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

        if (data.success && Array.isArray(data.result)) {
            return data.result;
        } else if (Array.isArray(data)) {
            return data;
        } else {
            throw new Error(`Format de réponse inattendu: ${JSON.stringify(data)}`);
        }
    }
};

export default expenseCategoryService;
