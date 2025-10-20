// ExpenseAccountService - Service pour la gestion des comptes de dépenses
import {
    getStoredCredentials,
    type AuthUser
} from "./authService";
import { getCurrentApiUrl } from "./config/configService";
import * as SQLite from 'expo-sqlite';
import { EventEmitter } from 'events';

// Event Emitter pour les mises à jour en temps réel
const expenseAccountEventEmitter = new EventEmitter();

// SQLite Database
let db: SQLite.SQLiteDatabase | null = null;

// Initialize Database
const initDatabase = async () => {
    if (db) return db;

    try {
        db = await SQLite.openDatabaseAsync('geo_lambert.db');

        // Create expense_accounts table
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS expense_accounts
            (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);

        console.log('✅ Expense Accounts Database initialized');
        return db;
    } catch (error) {
        console.error('❌ Error initializing expense accounts database:', error);
        throw error;
    }
};

// ==================== INTERFACES ====================

export interface ExpenseTransaction {
    id: number;
    name: string;
    display_name: string;
    balance: number;
    solde_amount: number;
    expense_move_type: 'spent' | 'replenish';
    date: string;
    expense_type_id?: [number, string] | false;
    expense_category_id?: [number, string] | false;
    project_id?: [number, string] | false;
    task_id?: [number, string] | false;
    currency_id?: [number, string] | false;
    description?: string | false;
}

export interface ExpenseMonth {
    id: number;
    name: string;
    display_name: string;
    caisse_id: [number, string];
    sold: number;
    solde_initial: number;
    solde_final: number;
    transaction_ids: ExpenseTransaction[];
}

export interface ExpenseAccount {
    id: number;
    name: string;
    display_name: string;
    employee_id: [number, string];
    month_ids: ExpenseMonth[];
}

export interface ExpenseAccountResponse {
    success: boolean;
    result?: ExpenseAccount[];
    message?: string;
    operation_info?: {
        model: string;
        method: string;
        user: string;
    };
    timestamp?: string;
}

// ==================== SERVICE ====================

export const expenseAccountService = {
    /**
     * 📂 CHARGEMENT : Comptes de dépenses depuis SQLite
     */
    async loadExpenseAccountsFromCache(): Promise<ExpenseAccount[]> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            const rows = await database.getAllAsync<{ id: number; data: string; updated_at: number }>(
                'SELECT id, data, updated_at FROM expense_accounts ORDER BY id'
            );

            if (rows.length === 0) {
                console.log('📂 Aucun compte de dépenses en cache SQLite');
                return [];
            }

            const accounts = rows.map(row => JSON.parse(row.data) as ExpenseAccount);
            const cacheDate = new Date(rows[0].updated_at);

            console.log(`📂 ${accounts.length} comptes de dépenses chargés depuis SQLite (cache: ${cacheDate.toLocaleString('fr-FR')})`);
            return accounts;
        } catch (error) {
            console.error('❌ Erreur chargement comptes de dépenses SQLite:', error);
            return [];
        }
    },

    /**
     * 💾 SAUVEGARDE : Comptes de dépenses dans SQLite
     */
    async saveExpenseAccountsToCache(accounts: ExpenseAccount[]): Promise<void> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            await database.withTransactionAsync(async () => {
                // Clear old data
                await database.runAsync('DELETE FROM expense_accounts');

                // Save each account
                const timestamp = Date.now();
                for (const account of accounts) {
                    await database.runAsync(
                        'INSERT INTO expense_accounts (id, data, updated_at) VALUES (?, ?, ?)',
                        [account.id, JSON.stringify(account), timestamp]
                    );
                }
            });

            console.log(`💾 ${accounts.length} comptes de dépenses sauvegardés dans SQLite`);
        } catch (error) {
            console.error('❌ Erreur sauvegarde comptes de dépenses SQLite:', error);
        }
    },

    /**
     * ✅ RÉCUPÉRATION : Tous les comptes de dépenses (avec cache SQLite offline-first)
     */
    async getExpenseAccounts(): Promise<ExpenseAccountResponse> {
        try {
            console.log('📊 Récupération des comptes de dépenses (offline-first)...');

            // 1. Charger depuis SQLite d'abord
            const cachedAccounts = await this.loadExpenseAccountsFromCache();

            if (cachedAccounts.length > 0) {
                console.log(`📂 ${cachedAccounts.length} comptes trouvés dans cache SQLite`);

                // Rafraîchir depuis l'API en arrière-plan
                this.refreshExpenseAccountsInBackground();

                return {
                    success: true,
                    result: cachedAccounts,
                    message: 'Données chargées depuis le cache local'
                };
            }

            // 2. Si cache vide, charger depuis l'API
            console.log('📂 Cache SQLite vide, chargement depuis API...');
            
            const currentUser = await this.getCurrentUserAuth();
            if (!currentUser) {
                throw new Error('Aucune authentification trouvée');
            }

            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            const payload = {
                "operation": "rpc",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "model": "hr.expense.account",
                "method": "read",
                "args": [[currentUser.case_id]],
                "kwargs": {
                    "fields": ["name", "month_ids", "display_name", "employee_id"],
                    "replaceToObject": [{
                        "month_ids": {
                            "hr.expense.account.month": [
                                "name",
                                "display_name",
                                "transaction_ids",
                                "solde_initial",
                                "solde_final",
                                "sold",
                                "caisse_id"
                            ]
                        },
                        "month_ids.transaction_ids": {
                            "hr.expense.account.move": [
                                "balance",
                                "solde_amount",
                                "expense_move_type",
                                "name",
                                "date",
                                "expense_type_id",
                                "expense_category_id",
                                "project_id",
                                "task_id",
                                "currency_id",
                                "display_name",
                                "description"
                            ]
                        }
                    }]
                }
            };

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
                console.log(`✅ ${data.result.length} comptes de dépenses récupérés depuis API`);

                // Sauvegarder dans le cache
                if (data.result.length > 0) {
                    await this.saveExpenseAccountsToCache(data.result);
                }

                return {
                    success: true,
                    result: data.result,
                    operation_info: data.operation_info,
                    timestamp: data.timestamp
                };
            } else {
                throw new Error('Format de réponse inattendu');
            }

        } catch (error) {
            console.error('❌ Erreur récupération comptes de dépenses:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue',
                result: []
            };
        }
    },

    /**
     * 🔄 REFRESH : Rafraîchir les comptes depuis l'API en arrière-plan
     */
    async refreshExpenseAccountsInBackground(): Promise<void> {
        try {
            console.log('🔄 Rafraîchissement comptes de dépenses en arrière-plan...');

            const currentUser = await this.getCurrentUserAuth();
            if (!currentUser) return;

            const credentials = await getStoredCredentials();
            if (!credentials) return;

            const payload = {
                "operation": "rpc",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "model": "hr.expense.account",
                "method": "read",
                "args": [[currentUser.case_id]],
                "kwargs": {
                    "fields": ["name", "month_ids", "display_name", "employee_id"],
                    "replaceToObject": [{
                        "month_ids": {
                            "hr.expense.account.month": [
                                "name",
                                "display_name",
                                "transaction_ids",
                                "solde_initial",
                                "solde_final",
                                "sold",
                                "caisse_id"
                            ]
                        },
                        "month_ids.transaction_ids": {
                            "hr.expense.account.move": [
                                "balance",
                                "solde_amount",
                                "expense_move_type",
                                "name",
                                "date",
                                "expense_type_id",
                                "expense_category_id",
                                "project_id",
                                "task_id",
                                "currency_id",
                                "display_name",
                                "description"
                            ]
                        }
                    }]
                }
            };

            const apiUrl = getCurrentApiUrl();
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && Array.isArray(data.result)) {
                    await this.saveExpenseAccountsToCache(data.result);
                    console.log('✅ Cache comptes de dépenses mis à jour en arrière-plan');
                }
            }
        } catch (error) {
            console.warn('⚠️ Échec rafraîchissement comptes de dépenses en arrière-plan:', error);
        }
    },

    /**
     * 🔄 FORCE REFRESH : Forcer la synchronisation depuis l'API
     */
    async forceRefreshExpenseAccounts(): Promise<ExpenseAccountResponse> {
        try {
            console.log('🔄 Force refresh comptes de dépenses...');

            const currentUser = await this.getCurrentUserAuth();
            if (!currentUser) {
                throw new Error('Aucune authentification trouvée');
            }

            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            const payload = {
                "operation": "rpc",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "model": "hr.expense.account",
                "method": "read",
                "args": [[currentUser.case_id]],
                "kwargs": {
                    "fields": ["name", "month_ids", "display_name", "employee_id"],
                    "replaceToObject": [{
                        "month_ids": {
                            "hr.expense.account.month": [
                                "name",
                                "display_name",
                                "transaction_ids",
                                "solde_initial",
                                "solde_final",
                                "sold",
                                "caisse_id"
                            ]
                        },
                        "month_ids.transaction_ids": {
                            "hr.expense.account.move": [
                                "balance",
                                "solde_amount",
                                "expense_move_type",
                                "name",
                                "date",
                                "expense_type_id",
                                "expense_category_id",
                                "project_id",
                                "task_id",
                                "currency_id",
                                "display_name",
                                "description"
                            ]
                        }
                    }]
                }
            };

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
                console.log(`✅ ${data.result.length} comptes de dépenses rafraîchis`);

                // Sauvegarder dans le cache
                await this.saveExpenseAccountsToCache(data.result);
                
                // Émettre l'événement
                if (data.result.length > 0) {
                    expenseAccountEventEmitter.emit('expenseAccountsUpdated', data.result[0]);
                }

                return {
                    success: true,
                    result: data.result,
                    operation_info: data.operation_info,
                    timestamp: data.timestamp
                };
            } else {
                throw new Error('Format de réponse inattendu');
            }

        } catch (error) {
            console.error('❌ Erreur force refresh comptes de dépenses:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    },

    /**
     * 📡 WEBSOCKET UPDATE : Mettre à jour le mois depuis payload WebSocket
     * @param caseId - ID de la caisse (hr.expense.account)
     * @param monthPayload - Payload WebSocket du mois
     */
    async updateExpenseMonthFromWebSocket(
        caseId: number,
        monthPayload: any
    ): Promise<{ success: boolean; message?: string }> {
        try {
            console.log('📡 Mise à jour mois depuis WebSocket:', {
                event_type: monthPayload.event_type,
                month_id: monthPayload.id,
                case_id: caseId
            });

            // 1. Charger les comptes depuis SQLite
            let accounts = await this.loadExpenseAccountsFromCache();

            if (accounts.length === 0) {
                console.log('⚠️ Pas de cache SQLite, force refresh depuis API...');
                const response = await this.forceRefreshExpenseAccounts();
                return { success: response.success, message: response.message };
            }

            // 2. Trouver le compte correspondant au case_id
            const accountIndex = accounts.findIndex(acc => acc.id === caseId);
            if (accountIndex === -1) {
                console.warn(`⚠️ Compte ${caseId} non trouvé dans le cache`);
                return { success: false, message: 'Compte non trouvé' };
            }

            // 3. Mettre à jour selon event_type
            switch (monthPayload.event_type) {
                case 'created':
                    // Ajouter le nouveau mois s'il n'existe pas
                    if (!accounts[accountIndex].month_ids.find(m => m.id === monthPayload.id)) {
                        accounts[accountIndex].month_ids.push(monthPayload as ExpenseMonth);
                        console.log('➕ Mois ajouté:', monthPayload.id);
                    }
                    break;

                case 'updated':
                    // Mettre à jour le mois existant
                    const monthIndex = accounts[accountIndex].month_ids.findIndex(m => m.id === monthPayload.id);
                    if (monthIndex !== -1) {
                        accounts[accountIndex].month_ids[monthIndex] = monthPayload as ExpenseMonth;
                        console.log('✏️ Mois mis à jour:', monthPayload.id);
                    } else {
                        // Si pas trouvé, l'ajouter
                        accounts[accountIndex].month_ids.push(monthPayload as ExpenseMonth);
                        console.log('➕ Mois ajouté (update):', monthPayload.id);
                    }
                    break;

                case 'deleted':
                    // Supprimer le mois
                    const monthIndexToDelete = accounts[accountIndex].month_ids.findIndex(m => m.id === monthPayload.id);
                    if (monthIndexToDelete !== -1) {
                        accounts[accountIndex].month_ids.splice(monthIndexToDelete, 1);
                        console.log('🗑️ Mois supprimé:', monthPayload.id);
                    }
                    break;

                default:
                    console.warn('⚠️ event_type non géré:', monthPayload.event_type);
                    return { success: false, message: 'Event type non supporté' };
            }

            // 4. Sauvegarder dans SQLite
            await this.saveExpenseAccountsToCache(accounts);

            // 5. Émettre l'événement pour mettre à jour la vue
            expenseAccountEventEmitter.emit('expenseAccountsUpdated', accounts[accountIndex]);

            console.log('✅ Mois mis à jour depuis WebSocket avec succès');

            return { success: true, message: 'Mois mis à jour avec succès' };

        } catch (error) {
            console.error('❌ Erreur mise à jour mois depuis WebSocket:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    },

    /**
     * 🔑 GET CURRENT USER : Récupérer l'utilisateur actuel
     */
    async getCurrentUserAuth(): Promise<AuthUser | null> {
        try {
            const { authService } = await import('./authService');
            return await authService.getCurrentUser();
        } catch (error) {
            console.error('❌ Erreur récupération utilisateur:', error);
            return null;
        }
    }
};

// Fonction pour s'abonner aux mises à jour de comptes de dépenses
export const subscribeToExpenseAccountUpdates = (callback: (account: ExpenseAccount) => void) => {
    expenseAccountEventEmitter.on('expenseAccountsUpdated', callback);
    return () => expenseAccountEventEmitter.off('expenseAccountsUpdated', callback);
};

export default expenseAccountService;
