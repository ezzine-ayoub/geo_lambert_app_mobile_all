// CashboxService - Service pour la gestion de la caisse
import {getStoredCredentials} from "./authService";
import {getCurrentApiUrl} from "./config/configService";
import * as SQLite from 'expo-sqlite';
import {EventEmitter} from 'events';

// Event Emitter pour les mises à jour en temps réel
const cashboxEventEmitter = new EventEmitter();

// SQLite Database
let db: SQLite.SQLiteDatabase | null = null;

// Initialize Database
const initDatabase = async () => {
    if (db) return db;

    try {
        db = await SQLite.openDatabaseAsync('geo_lambert.db');

        // Create cashbox table
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS cashbox
            (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);

        console.log('✅ Cashbox table initialized successfully');
        return db;
    } catch (error) {
        console.error('❌ Error initializing cashbox table:', error);
        throw error;
    }
};

// ==================== INTERFACES ====================

// Structure d'un mouvement de caisse (dépense ou règlement)
export interface CashboxMove {
    id: number;
    balance?: number;
    solde_amount: number;       // Champ principal pour le montant
    amount?: number;             // Alias/fallback pour compatibilité
    expense_move_type: 'spent' | 'replenish';  // ✅ Type de mouvement: 'spent' = dépense, 'replenish' = règlement
    name?: string;
    write_date: string;
    create_date: string;
    display_name: string;
    description: string | false;
    task_id?: [number, string] | false;  // ✅ Format Odoo: [id, name] ou false
    date?: string;               // Date du mouvement
    expense_date?: string;       // Alias pour compatibilité
}

// Anciens types pour compatibilité (alias de CashboxMove)
export type CashboxExpense = CashboxMove;
export type CashboxSettlement = CashboxMove;

// Structure d'un compte de caisse (hr.expense.account)
export interface ExpenseAccount {
    id: number;
    name: string;
    balance: number;
    description?: string | false;
    expense_account_move_ids: CashboxMove[];  // Tous les mouvements (expenses + settlements)
    create_date: string;
    write_date: string;
}

// Structure des données de l'employé avec sa caisse
export interface EmployeeWithCashbox {
    id: number;
    name: string;
    caisse_id: ExpenseAccount[];  // ✅ Array format (Odoo Many2one avec replaceToObject)
    create_date: string;
    write_date: string;
}

// Structure de réponse pour compatibilité avec l'ancien code
export interface CashboxData {
    id: number;
    name: string;
    balance: number;
    settlement_ids: CashboxMove[];  // Filtrés par expense_move_type = 'settlement'
    expense_ids: CashboxMove[];     // Filtrés par expense_move_type = 'expense'
    total_settlements: number;
    total_expenses: number;
    create_date: string;
    write_date: string;
}

export interface CashboxResponse {
    success: boolean;
    result?: CashboxData[];
    message?: string;
    operation_info?: {
        model: string;
        method: string;
        user: string;
    };
    timestamp?: string;
}

// ==================== SERVICE CAISSE ====================

export const cashboxService = {
    /**
     * 💾 SAUVEGARDE : Données cashbox dans SQLite
     */
    async saveCashboxToCache(cashboxData: CashboxData): Promise<void> {
        try {
            console.log('💾 Tentative de sauvegarde cashbox:', {
                id: cashboxData.id,
                name: cashboxData.name,
                balance: cashboxData.balance
            });

            if (!cashboxData.id) {
                throw new Error('cashboxData.id est undefined - impossible de sauvegarder');
            }

            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            const timestamp = Date.now();
            await database.runAsync(
                'INSERT OR REPLACE INTO cashbox (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)',
                [cashboxData.id, JSON.stringify(cashboxData), timestamp, timestamp]
            );

            console.log(`💾 Cashbox ${cashboxData.id} sauvegardée dans SQLite`);
        } catch (error) {
            console.error('❌ Erreur sauvegarde cashbox SQLite:', error);
            console.error('🔍 Détails cashboxData:', {
                id: cashboxData?.id,
                hasData: !!cashboxData,
                keys: cashboxData ? Object.keys(cashboxData) : []
            });
        }
    },

    /**
     * 📂 CHARGEMENT : Données cashbox depuis SQLite
     */
    async loadCashboxFromCache(cashboxId: number): Promise<CashboxData | null> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            const row = await database.getFirstAsync<{ id: number; data: string; updated_at: number }>(
                'SELECT id, data, updated_at FROM cashbox WHERE id = ?',
                [cashboxId]
            );

            if (!row) {
                console.log('📂 Aucune cashbox en cache SQLite');
                return null;
            }

            const cashboxData = JSON.parse(row.data) as CashboxData;
            const cacheDate = new Date(row.updated_at);

            console.log(`📂 Cashbox ${cashboxId} chargée depuis SQLite (cache: ${cacheDate.toLocaleString('fr-FR')})`);
            return cashboxData;
        } catch (error) {
            console.error('❌ Erreur chargement cashbox SQLite:', error);
            return null;
        }
    },

    /**
     * 🗑️ CLEAR : Vider toutes les données cashbox
     */
    async clearCashboxCache(): Promise<boolean> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            await database.runAsync('DELETE FROM cashbox');
            console.log('✅ Cache cashbox vidé');

            // Émettre un événement
            cashboxEventEmitter.emit('cashboxCleared');
            return true;
        } catch (error) {
            console.error('❌ Erreur vidage cache cashbox:', error);
            return false;
        }
    },
    /**
     * 📊 RÉCUPÉRATION : Données de la caisse (offline-first avec SQLite)
     * @param employeeId - ID de l'employé (au lieu de case_id)
     */
    async getCashboxData(employeeId?: number): Promise<CashboxResponse> {
        if (!employeeId) {
            return {
                success: false,
                message: 'employee_id manquant - veuillez le passer en paramètre'
            };
        }

        try {
            console.log('💰 Récupération cashbox (offline-first)...');

            // 1. TOUJOURS essayer de charger depuis SQLite d'abord
            // Note: On utilise toujours l'ID de la caisse pour le cache
            const cachedCashbox = await this.loadCashboxFromCache(employeeId);

            if (cachedCashbox) {
                console.log(`📂 Cashbox trouvée dans cache SQLite`);

                // Rafraîchir depuis l'API en arrière-plan (fire and forget)
                this.refreshCashboxInBackground(employeeId);

                // Retourner immédiatement les données en cache
                return {
                    success: true,
                    result: [cachedCashbox],
                    message: 'Données chargées depuis le cache local'
                };
            }

            // 2. Si cache vide, charger depuis l'API et ATTENDRE la réponse
            console.log('📂 Cache SQLite vide, chargement depuis API...');
            return await this.fetchCashboxFromAPI(employeeId);

        } catch (error) {
            console.error('❌ Erreur récupération cashbox:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    },

    /**
     * 🌐 FETCH : Récupérer cashbox depuis l'API (nouvelle structure hr.employee)
     * @param employeeId - ID de l'employé
     */
    async fetchCashboxFromAPI(employeeId: number): Promise<CashboxResponse> {
        try {
            console.log(`💰 Récupération cashbox pour employé ${employeeId} depuis API...`);

            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            const payload = {
                operation: "rpc",
                db: credentials.db,
                username: credentials.username,
                password: credentials.password,
                model: "hr.employee",
                method: "read",
                args: [[employeeId]],
                kwargs: {
                    fields: [
                        "name",
                        "caisse_id",
                        "create_date",
                        "write_date"
                    ],
                    replaceToObject: [
                        {
                            caisse_id: {
                                "hr.expense.account": [
                                    "name",
                                    "balance",
                                    "description",
                                    "expense_account_move_ids"
                                ]
                            },
                            "caisse_id.expense_account_move_ids": {
                                "hr.expense.account.move": [
                                    "create_date",
                                    "write_date",
                                    "user_id",
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
                            },
                            "caisse_id.expense_account_move_ids.expense_category_id": {
                                "expense.category": ["name", "display_name"]
                            },
                            "caisse_id.expense_account_move_ids.expense_type_id": {
                                "expense.type": ["name", "display_name"]
                            },
                            "caisse_id.expense_account_move_ids.task_id": {
                                "project.task": ["name"]
                            }
                        }
                    ]
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
            console.log('📥 Réponse cashbox reçue:', {
                success: data.success,
                hasResult: !!data.result,
                resultLength: data.result?.length || 0
            });

            if (data.success && data.result && Array.isArray(data.result) && data.result.length > 0) {
                const employeeData: EmployeeWithCashbox = data.result[0];

                console.log('🔍 Données employé reçues:', {
                    employee_id: employeeData.id,
                    employee_name: employeeData.name,
                    has_caisse: !!employeeData.caisse_id,
                    is_array: Array.isArray(employeeData.caisse_id),
                    caisse_length: Array.isArray(employeeData.caisse_id) ? employeeData.caisse_id.length : 0
                });

                // ✅ Vérifier que caisse_id existe et est un array non vide
                if (!employeeData.caisse_id || !Array.isArray(employeeData.caisse_id) || employeeData.caisse_id.length === 0) {
                    throw new Error('Aucune caisse associée à cet employé');
                }

                console.log(`✅ Cashbox employé ${employeeId} récupérée depuis API`);

                // Transformer en format CashboxData pour compatibilité
                const cashboxData = this.transformEmployeeDataToCashbox(employeeData);

                // Sauvegarder dans le cache SQLite
                await this.saveCashboxToCache(cashboxData);

                return {
                    success: true,
                    result: [cashboxData],
                    operation_info: data.operation_info,
                    timestamp: data.timestamp
                };
            } else {
                console.warn('⚠️ Format de réponse inattendu:', data);
                return {
                    success: false,
                    message: 'Format de réponse inattendu'
                };
            }

        } catch (error) {
            console.error('❌ Erreur fetch cashbox API:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    },

    /**
     * 🔄 TRANSFORM : Convertir EmployeeWithCashbox en CashboxData
     */
    transformEmployeeDataToCashbox(employeeData: EmployeeWithCashbox): CashboxData {
        // ✅ caisse_id est un array dans le format Odoo, prendre le premier élément
        if (!employeeData.caisse_id || employeeData.caisse_id.length === 0) {
            throw new Error('Aucune caisse trouvée pour cet employé');
        }

        const caisse = employeeData.caisse_id[0];  // ✅ Prendre le premier élément de l'array
        const moves = caisse.expense_account_move_ids || [];

        console.log('🔄 Transformation des données:', {
            employee_id: employeeData.id,
            caisse_id: caisse.id,
            caisse_name: caisse.name,
            total_moves: moves.length
        });

        // ✅ Séparer les expenses (spent) et settlements (replenish)
        const expense_ids = moves.filter(m => m.expense_move_type === 'spent');
        const settlement_ids = moves.filter(m => m.expense_move_type === 'replenish');

        console.log('📊 Stats mouvements:', {
            expenses: expense_ids.length,
            settlements: settlement_ids.length
        });

        // Calculer les totaux
        const total_expenses = expense_ids.reduce((sum, e) => {
            const amount = e.solde_amount ?? e.amount ?? e.balance ?? 0;
            return sum + Math.abs(amount);
        }, 0);

        const total_settlements = settlement_ids.reduce((sum, s) => {
            const amount = s.solde_amount ?? s.amount ?? s.balance ?? 0;
            return sum + Math.abs(amount);
        }, 0);

        // ✅ Utiliser l'ID de l'employé comme ID de cache (au lieu de caisse.id)
        const cashboxData: CashboxData = {
            id: employeeData.id,  // ✅ Utiliser l'ID de l'employé
            name: caisse.name,
            balance: caisse.balance,
            expense_ids,
            settlement_ids,
            total_expenses,
            total_settlements,
            create_date: caisse.create_date,
            write_date: caisse.write_date
        };

        console.log('✅ Transformation terminée:', {
            id: cashboxData.id,
            balance: cashboxData.balance,
            total_expenses: cashboxData.total_expenses,
            total_settlements: cashboxData.total_settlements
        });

        return cashboxData;
    },

    /**
     * 🔄 REFRESH : Rafraîchir cashbox depuis l'API en arrière-plan
     * @param employeeId - ID de l'employé
     */
    async refreshCashboxInBackground(employeeId: number): Promise<void> {
        try {
            console.log(`🔄 Rafraîchissement cashbox employé ${employeeId} en arrière-plan...`);
            const response = await this.fetchCashboxFromAPI(employeeId);

            if (response.success) {
                console.log('✅ Cache cashbox mis à jour en arrière-plan');
                // Émettre un événement pour notifier les composants
                if (response.result && response.result.length > 0) {
                    cashboxEventEmitter.emit('cashboxUpdated', response.result[0]);
                }
            }
        } catch (error) {
            console.warn('⚠️ Échec rafraîchissement cashbox en arrière-plan (pas grave):', error);
        }
    },

    /**
     * 📡 WEBSOCKET UPDATE : Mettre à jour cashbox depuis payload WebSocket
     * @param employeeId - ID de l'employé
     * @param expensePayload - Payload WebSocket de la dépense
     */
    async updateCashboxFromWebSocket(employeeId: number, expensePayload: any): Promise<{
        success: boolean;
        message?: string
    }> {
        try {
            console.log('📡 Mise à jour cashbox depuis WebSocket:', {
                event_type: expensePayload.event_type,
                expense_id: expensePayload.id,
                employee_id: employeeId
            });

            // 1. Charger la cashbox actuelle depuis SQLite
            let cashboxData = await this.loadCashboxFromCache(employeeId);

            // Si pas de cache, faire un fetch complet
            if (!cashboxData) {
                console.log('⚠️ Pas de cache SQLite, force refresh depuis API...');
                const response = await this.forceRefreshCashbox(employeeId);
                return {success: response.success, message: response.message};
            }

            // 2. Convertir le payload WebSocket en CashboxMove
            const newMove: CashboxMove = {
                id: expensePayload.id,
                name: expensePayload.name || '',
                display_name: expensePayload.display_name || '',
                solde_amount: expensePayload.solde_amount || 0,
                balance: expensePayload.balance,
                expense_move_type: expensePayload.expense_move_type || 'spent',
                date: expensePayload.date,
                description: expensePayload.description || false,
                create_date: expensePayload.create_date,
                write_date: expensePayload.write_date,
                // ✅ Convertir task_id array d'objets en format [id, name]
                task_id: expensePayload.task_id && expensePayload.task_id.length > 0
                    ? [expensePayload.task_id[0].id, expensePayload.task_id[0].name]
                    : false
            };

            // 3. Mettre à jour selon event_type
            switch (expensePayload.event_type) {
                case 'created':
                    // Ajouter la nouvelle dépense
                    if (newMove.expense_move_type === 'spent') {
                        // Vérifier si elle n'existe pas déjà
                        if (!cashboxData.expense_ids.find(e => e.id === newMove.id)) {
                            cashboxData.expense_ids.push(newMove);
                            console.log('➕ Dépense ajoutée:', newMove.id);
                        }
                    } else if (newMove.expense_move_type === 'replenish') {
                        if (!cashboxData.settlement_ids.find(s => s.id === newMove.id)) {
                            cashboxData.settlement_ids.push(newMove);
                            console.log('➕ Alimentation ajoutée:', newMove.id);
                        }
                    }
                    break;

                case 'updated':
                    // Mettre à jour la dépense existante
                    if (newMove.expense_move_type === 'spent') {
                        const expenseIndex = cashboxData.expense_ids.findIndex(e => e.id === newMove.id);
                        if (expenseIndex !== -1) {
                            cashboxData.expense_ids[expenseIndex] = newMove;
                            console.log('✏️ Dépense mise à jour:', newMove.id);
                        } else {
                            // Si pas trouvée, l'ajouter (cas création manquée)
                            cashboxData.expense_ids.push(newMove);
                            console.log('➕ Dépense ajoutée (update):', newMove.id);
                        }
                    } else if (newMove.expense_move_type === 'replenish') {
                        const settlementIndex = cashboxData.settlement_ids.findIndex(s => s.id === newMove.id);
                        if (settlementIndex !== -1) {
                            cashboxData.settlement_ids[settlementIndex] = newMove;
                            console.log('✏️ Alimentation mise à jour:', newMove.id);
                        } else {
                            cashboxData.settlement_ids.push(newMove);
                            console.log('➕ Alimentation ajoutée (update):', newMove.id);
                        }
                    }
                    break;

                case 'deleted':
                    // Supprimer la dépense
                    const expenseIndexToDelete = cashboxData.expense_ids.findIndex(e => e.id === expensePayload.id);
                    if (expenseIndexToDelete !== -1) {
                        cashboxData.expense_ids.splice(expenseIndexToDelete, 1);
                        console.log('🗑️ Dépense supprimée:', expensePayload.id);
                    }

                    const settlementIndexToDelete = cashboxData.settlement_ids.findIndex(s => s.id === expensePayload.id);
                    if (settlementIndexToDelete !== -1) {
                        cashboxData.settlement_ids.splice(settlementIndexToDelete, 1);
                        console.log('🗑️ Alimentation supprimée:', expensePayload.id);
                    }
                    break;

                default:
                    console.warn('⚠️ event_type non géré:', expensePayload.event_type);
                    return {success: false, message: 'Event type non supporté'};
            }

            // 4. Recalculer les totaux
            cashboxData.total_expenses = cashboxData.expense_ids.reduce((sum, e) => {
                const amount = e.solde_amount ?? e.amount ?? e.balance ?? 0;
                return sum + Math.abs(amount);
            }, 0);

            cashboxData.total_settlements = cashboxData.settlement_ids.reduce((sum, s) => {
                const amount = s.solde_amount ?? s.amount ?? s.balance ?? 0;
                return sum + Math.abs(amount);
            }, 0);

            // 5. Mettre à jour le balance (solde = alimentations - dépenses)
            cashboxData.balance = cashboxData.total_settlements - cashboxData.total_expenses;

            // 6. Mettre à jour write_date
            cashboxData.write_date = new Date().toISOString();

            console.log('📊 Nouveaux totaux:', {
                balance: cashboxData.balance,
                total_expenses: cashboxData.total_expenses,
                total_settlements: cashboxData.total_settlements,
                expense_count: cashboxData.expense_ids.length,
                settlement_count: cashboxData.settlement_ids.length
            });

            // 7. Sauvegarder dans SQLite
            await this.saveCashboxToCache(cashboxData);

            // 8. Émettre l'événement pour mettre à jour la vue
            cashboxEventEmitter.emit('cashboxUpdated', cashboxData);

            console.log('✅ Cashbox mise à jour depuis WebSocket avec succès');

            return {success: true, message: 'Cashbox mise à jour avec succès'};

        } catch (error) {
            console.error('❌ Erreur mise à jour cashbox depuis WebSocket:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    },

    /**
     * 🔄 FORCE REFRESH : Synchronisation intelligente depuis l'API (update operation)
     * @param employeeId - ID de l'employé
     */
    async forceRefreshCashbox(employeeId: number): Promise<CashboxResponse> {
        try {
            console.log(`🔄 Force refresh cashbox employé ${employeeId} avec sync...`);

            // Pour simplifier, on utilise fetchCashboxFromAPI qui récupère toutes les données fraîches
            const response = await this.fetchCashboxFromAPI(employeeId);

            if (response.success && response.result && response.result.length > 0) {
                const cashboxData = response.result[0];

                // Sauvegarder dans le cache
                await this.saveCashboxToCache(cashboxData);

                // Émettre un événement
                cashboxEventEmitter.emit('cashboxUpdated', cashboxData);

                return {
                    success: true,
                    result: response.result,
                    message: 'Synchronisation réussie',
                    timestamp: response.timestamp
                };
            } else {
                throw new Error('Impossible de récupérer les données de la caisse');
            }

        } catch (error) {
            console.error('❌ Erreur force refresh cashbox:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    },

};

// Fonction pour s'abonner aux mises à jour de cashbox
export const subscribeToCashboxUpdates = (callback: (cashbox: CashboxData) => void) => {
    cashboxEventEmitter.on('cashboxUpdated', callback);
    return () => cashboxEventEmitter.off('cashboxUpdated', callback);
};

// Fonction pour s'abonner au vidage du cache
export const subscribeToCashboxCleared = (callback: () => void) => {
    cashboxEventEmitter.on('cashboxCleared', callback);
    return () => cashboxEventEmitter.off('cashboxCleared', callback);
};

export default cashboxService;
