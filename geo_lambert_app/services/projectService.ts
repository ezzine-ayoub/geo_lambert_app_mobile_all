// ProjectService - Service pour la gestion des projets
import {
    executePayloadWithStoredAuth,
    getStoredCredentials
} from "./authService";
import {
    PROJECT_PAYLOADS,
    EXPENSE_PAYLOADS,
    getCurrentApiUrl
} from "./config/configService";
import * as SQLite from 'expo-sqlite';
import {EventEmitter} from 'events';

// Event Emitter pour les mises à jour en temps réel
const projectEventEmitter = new EventEmitter();

// SQLite Database
let db: SQLite.SQLiteDatabase | null = null;

// Initialize Database
const initDatabase = async () => {
    if (db) return db;

    try {
        db = await SQLite.openDatabaseAsync('geo_lambert.db');

        // Create projects table
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS projects
            (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);

        console.log('✅ Database initialized successfully');
        return db;
    } catch (error) {
        console.error('❌ Error initializing database:', error);
        throw error;
    }
};

// ==================== INTERFACES POUR LES PROJETS ====================

export interface ProjectTask {
    id: number;
    name: string;
    state: string;
    partner_id?: [number, string] | false;
    user_ids?: Array<{ id: number; name: string; display_name: string }>;
    expense_ids?: Array<{
        id: number;
        amount?: number;
        expense_date: string;
        expense_type?: string; // Legacy field
        expense_type_id?: Array<{ id: number; name: string; display_name: string }>;
        expense_category_id?: Array<{ id: number; name: string; display_name: string }>;
        project_id?: [number, string];
        task_id?: [number, string];
        currency_id?: [number, string];
        display_name?: string;
        description?: string;
    }>;
    display_name: string;
    timer_start?: string | false;
    timer_pause?: string | false;
    advance_amount?: number; // Montant d'avance
    advance_date?: string;
}

export interface Project {
    id: number;
    name: string;
    project_type: string;
    partner_id?: [number, string] | false;
    date_start?: string | false;
    date?: string | false;
    task_ids?: ProjectTask[];
    numero?: string | false;
    write_date?: string;
    create_date?: string;
}

export interface ProjectsResponse {
    success: boolean;
    result?: Project[];
    message?: string;
    operation_info?: {
        model: string;
        method: string;
        user: string;
    };
    timestamp?: string;
}

export interface ProjectStats {
    totalProjects: number;
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    completionRate: number;
    situationProjects: number;
    normalProjects: number;
    totalExpenses: number;
    expenseCount: number;
}

export interface ExpenseData {
    user_id: number;
    expense_type_id: number;
    expense_category_id: number;
    amount: number;
    description: string;
    expense_date?: string;
}

export interface ExpenseResponse {
    success: boolean;
    message?: string;
    data?: any;
    result?: any;
}

// ==================== SERVICE PROJETS ====================

export const projectService = {
    /**
     * 🔄 FORCE REFRESH : Synchronisation intelligente depuis l'API (pull-to-refresh)
     */
    async forceRefreshProjects(): Promise<ProjectsResponse> {
        try {
            // 1. Charger les projets actuels depuis SQLite pour construire le payload
            const cachedProjects = await this.loadProjectsFromCache();

            // 2. Construire le payload de synchronisation
            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            // Créer la liste des objets avec id, write_date, create_date
            const objects = cachedProjects.map(project => ({
                id: project.id,
                task_ids: project.task_ids?.map(task => ({
                    id: task.id,
                    write_date: project.write_date || new Date().toISOString(),
                    create_date: project.create_date || new Date().toISOString()
                }))
            }));

            const syncPayload = {
                "operation": "update",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "body": {
                    "project.project": {
                        "objects": objects,
                        "fields": [
                            "name",
                            "project_type",
                            "partner_id",
                            "date_start",
                            "date",
                            "task_ids",
                            "numero",
                            "write_date",
                            "create_date"
                        ],
                        "replaceToObject": [{
                            "partner_id": {
                                "res.partner": ["name", "street"]
                            },
                            "task_ids": {
                                "project.task": [
                                    "name",
                                    "state",
                                    "partner_id",
                                    "user_ids",
                                    "expense_ids",
                                    "timer_start",
                                    "timer_pause",
                                    // "advance_amount",
                                    // "advance_date"
                                ]
                            },
                            "task_ids.partner_id": {
                                "res.partner": ["name", "street"]
                            },
                            "task_ids.user_ids": {
                                "res.users": ["name"]
                            },
                            "task_ids.expense_ids": {
                                "task.expense": [
                                    "amount",
                                    "expense_date",
                                    "expense_type_id",
                                    "expense_category_id",
                                    "project_id",
                                    "task_id",
                                    "currency_id",
                                    "display_name",
                                    "description"
                                ]
                            },
                            'task_ids.expense_ids.expense_category_id': {
                                "expense.category": ['name', "display_name"],
                            },
                            'task_ids.expense_ids.expense_type_id': {
                                "expense.type": ['name', "display_name"],
                            }
                        }]
                    }
                }
            };
            console.log("AYOUB EZZINE", JSON.stringify(syncPayload, null, 2));
            // 3. Envoyer la requête de synchronisation
            const apiUrl = getCurrentApiUrl();
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(syncPayload)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('📥 Réponse sync reçue:', {
                success: data.success,
                updated: data.summary?.total_updated,
                deleted: data.summary?.total_deleted,
                total: data.summary?.total_objects
            });

            if (data.success && data.result && data.result['project.project']) {
                const updatedProjects = data.result['project.project'];
                const deleteIds = data.delete_ids?.['project.project'] || [];

                console.log(`✅ Sync: ${updatedProjects.length} projets mis à jour, ${deleteIds.length} à supprimer`);

                // 4. Appliquer les changements à SQLite
                await this.applySyncChanges(updatedProjects, deleteIds, cachedProjects);

                // 5. Recharger tous les projets depuis SQLite
                const finalProjects = await this.loadProjectsFromCache();

                return {
                    success: true,
                    result: finalProjects,
                    message: `Synchronisation réussie: ${updatedProjects.length} mis à jour, ${deleteIds.length} supprimés`,
                    timestamp: data.timestamp
                };
            } else {
                throw new Error(`Format de réponse inattendu: ${JSON.stringify(data)}`);
            }
        } catch (error) {
            console.error('❌ Erreur force refresh projets:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    },

    /**
     * 🔄 APPLIQUER SYNC : Appliquer les changements de synchronisation à SQLite
     */
    async applySyncChanges(updatedProjects: Project[], deleteIds: number[], currentProjects: Project[]): Promise<void> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            // 1. Supprimer les projets obsolètes
            if (deleteIds.length > 0) {
                const placeholders = deleteIds.map(() => '?').join(',');
                await database.runAsync(
                    `DELETE
                     FROM projects
                     WHERE id IN (${placeholders})`,
                    deleteIds
                );
                console.log(`🗑️ ${deleteIds.length} projets supprimés de SQLite`);
            }

            // 2. Insérer ou remplacer les projets modifiés (UPSERT)
            const timestamp = Date.now();
            for (const project of updatedProjects) {
                await database.runAsync(
                    'INSERT OR REPLACE INTO projects (id, data, updated_at) VALUES (?, ?, ?)',
                    [project.id, JSON.stringify(project), timestamp]
                );
            }

            console.log(`💾 ${updatedProjects.length} projets insérés/mis à jour dans SQLite (UPSERT)`);

        } catch (error) {
            console.error('❌ Erreur application sync SQLite:', error);
            throw error;
        }
    },

    /**
     * 💾 SAUVEGARDE : Projets dans SQLite
     */
    async saveProjectsToCache(projects: Project[]): Promise<void> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            // ✅ Utiliser une transaction pour garantir l'atomicité
            await database.withTransactionAsync(async () => {
                // Clear old data
                await database.runAsync('DELETE FROM projects');

                // Save each project
                const timestamp = Date.now();
                for (const project of projects) {
                    await database.runAsync(
                        'INSERT INTO projects (id, data, updated_at) VALUES (?, ?, ?)',
                        [project.id, JSON.stringify(project), timestamp]
                    );
                }
            });

            console.log(`💾 ${projects.length} projets sauvegardés dans SQLite`);
        } catch (error) {
            console.error('❌ Erreur sauvegarde projets SQLite:', error);
        }
    },

    /**
     * 📂 CHARGEMENT : Projets depuis SQLite
     */
    async loadProjectsFromCache(): Promise<Project[]> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            const rows = await database.getAllAsync<{ id: number; data: string; updated_at: number }>(
                'SELECT id, data, updated_at FROM projects ORDER BY id'
            );

            if (rows.length === 0) {
                console.log('📂 Aucun projet en cache SQLite');
                return [];
            }

            const projects = rows.map(row => JSON.parse(row.data) as Project);
            const cacheDate = new Date(rows[0].updated_at);

            console.log(`📂 ${projects.length} projets chargés depuis SQLite (cache: ${cacheDate.toLocaleString('fr-FR')})`);
            return projects;
        } catch (error) {
            console.error('❌ Erreur chargement projets SQLite:', error);
            return [];
        }
    },

    /**
     * ✅ RÉCUPÉRATION : Tous les projets (avec cache SQLite offline-first)
     * Strategy: Load from SQLite first, then refresh from API in background
     * ⚠️ Si cache vide : charge TOUJOURS depuis l'API (pas de retour vide)
     */
    async getProjects(): Promise<ProjectsResponse> {
        try {
            console.log('📊 Récupération des projets (offline-first)...');

            // 1. TOUJOURS essayer de charger depuis SQLite d'abord
            const cachedProjects = await this.loadProjectsFromCache();

            if (cachedProjects.length > 0) {
                console.log(`📂 ${cachedProjects.length} projets trouvés dans cache SQLite`);

                // Rafraîchir depuis l'API en arrière-plan (fire and forget)
                this.refreshProjectsInBackground();

                // Retourner immédiatement les données en cache
                return {
                    success: true,
                    result: cachedProjects,
                    message: 'Données chargées depuis le cache local'
                };
            }

            // 2. ✅ Si cache vide, charger depuis l'API et ATTENDRE la réponse
            console.log('📂 Cache SQLite vide, chargement depuis API...');
            console.log('⏳ Attente de la réponse API...');

            const response = await executePayloadWithStoredAuth(
                (credentials) => PROJECT_PAYLOADS.getAllProjects(credentials)
            );

            console.log('🔍 Réponse API projets reçue:', {
                hasResponse: !!response,
                hasSuccess: response?.success,
                hasResult: !!response?.result,
                isResultArray: Array.isArray(response?.result),
                resultLength: response?.result?.length || 0
            });

            // Format API: { success: true, result: [...], operation_info: {...}, timestamp: '...' }
            if (response && response.success === true && Array.isArray(response.result)) {
                console.log(`✅ ${response.result.length} projets récupérés depuis API`);

                // ✅ Sauvegarder immédiatement dans le cache
                if (response.result.length > 0) {
                    await this.saveProjectsToCache(response.result);
                    console.log('💾 Projets sauvegardés dans le cache SQLite');
                }

                return {
                    success: true,
                    result: response.result,
                    operation_info: response.operation_info,
                    timestamp: response.timestamp
                };
            }
            // Fallback pour array direct
            else if (response && Array.isArray(response)) {
                console.log(`✅ ${response.length} projets récupérés depuis API (format array)`);

                // ✅ Sauvegarder immédiatement dans le cache
                if (response.length > 0) {
                    await this.saveProjectsToCache(response);
                    console.log('💾 Projets sauvegardés dans le cache SQLite');
                }

                return {
                    success: true,
                    result: response
                };
            } else {
                console.warn('⚠️ Format de réponse API inattendu:', response);
                return {
                    success: false,
                    message: `Format de réponse inattendu: ${response ? JSON.stringify(Object.keys(response)) : 'null'}`,
                    result: []
                };
            }

        } catch (error) {
            console.error('❌ Erreur récupération projets:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue',
                result: []
            };
        }
    },
    /**
     * 🔄 REFRESH : Rafraîchir les projets depuis l'API en arrière-plan
     */
    async refreshProjectsInBackground(): Promise<void> {
        try {
            console.log('🔄 Rafraîchissement en arrière-plan depuis API...');

            const response = await executePayloadWithStoredAuth(
                (credentials) => PROJECT_PAYLOADS.getAllProjects(credentials)
            );

            if (response && response.success === true && Array.isArray(response.result)) {
                console.log(`🔄 ${response.result.length} projets rafraîchis depuis API`);
                await this.saveProjectsToCache(response.result);
                console.log('✅ Cache SQLite mis à jour en arrière-plan');
            } else if (response && Array.isArray(response)) {
                console.log(`🔄 ${response.length} projets rafraîchis depuis API (format array)`);
                await this.saveProjectsToCache(response);
                console.log('✅ Cache SQLite mis à jour en arrière-plan');
            }
        } catch (error) {
            console.warn('⚠️ Échec rafraîchissement en arrière-plan (pas grave):', error);
        }
    },
    async getTaskTimerState(taskId: number): Promise<{ success: boolean; message?: string; data?: any }> {
        try {
            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            const payload = {
                "operation": "rpc",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "model": "project.task",
                "method": "search_read",
                "kwargs": {
                    "domain": [['id', '=', taskId]],
                    "fields": ["id", "name", "is_timer_running", "timer_pause", "timer_start", "effective_hours"]
                }
            };

            const apiUrl = getCurrentApiUrl();
            console.log('🔗 URL API Timer State:', apiUrl);
            console.log('📤 Payload Timer State:', JSON.stringify(payload, null, 2));

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
            console.log('🔍 Réponse Timer State:', JSON.stringify(data, null, 2));

            if (data.result && Array.isArray(data.result) && data.result.length > 0) {
                const taskData = data.result[0];
                console.log(`✅ État du timer pour la tâche ${taskId}:`, taskData);
                return {
                    success: true,
                    message: 'Timer state retrieved successfully',
                    data: taskData
                };
            } else {
                return {
                    success: false,
                    message: 'Impossible de récupérer l\'état du timer'
                };
            }

        } catch (error) {
            console.error(`❌ Erreur timer state tâche ${taskId}:`, error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue lors de la vérification'
            };
        }
    },
    async stopTaskTimerMultipleMethods(taskId: number): Promise<{ success: boolean; message?: string; data?: any }> {
        const credentials = await getStoredCredentials();
        if (!credentials) {
            throw new Error('Aucune authentification trouvée');
        }

        const apiUrl = getCurrentApiUrl();

        // Liste des méthodes possibles pour arrêter le timer
        const stopMethods = [
            'action_timer_stop_button',
            'action_timer_stop',
            'button_stop',
            'stop_timer',
            'timer_stop',
            'action_stop',
            'stop_timesheet',
            'toggle_timer'
        ];

        for (const method of stopMethods) {
            try {
                console.log(`🔄 Tentative avec méthode: ${method}`);

                const payload = {
                    "operation": "rpc",
                    "db": credentials.db,
                    "username": credentials.username,
                    "password": credentials.password,
                    "model": "project.task",
                    "method": method,
                    "args": [[taskId]]
                };

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    console.log(`❌ ${method} - HTTP Error: ${response.status}`);
                    continue;
                }

                const data = await response.json();
                console.log(`🔍 ${method} - Réponse:`, JSON.stringify(data, null, 2));

                // Si pas d'erreur, considérer comme succès
                if (data.success || (!data.error && data.result !== false)) {
                    console.log(`✅ Succès avec la méthode: ${method}`);
                    return {
                        success: true,
                        message: `Timer arrêté avec succès (méthode: ${method})`,
                        data: {method, result: data.result}
                    };
                } else {
                    console.log(`⚠️ ${method} - Erreur:`, data.message || data.error?.message || 'Erreur inconnue');
                }

            } catch (error) {
                // @ts-ignore
                console.log(`❌ ${method} - Exception:`, error.message);
                continue;
            }
        }

        return {
            success: false,
            message: `Toutes les méthodes d'arrêt ont échoué pour la tâche ${taskId}. Méthodes essayées: ${stopMethods.join(', ')}`
        };
    },
    async createExpense(taskId: number, expenseData: ExpenseData): Promise<ExpenseResponse> {
        try {
            console.log(`💰 Création d'une dépense pour la tâche ${taskId}...`, expenseData);

            const response = await executePayloadWithStoredAuth(
                (credentials) => EXPENSE_PAYLOADS.createExpense(credentials, taskId, expenseData)
            );

            console.log('🔍 Réponse API création dépense:', response);

            if (response && (response.success === true || response.result || response.id)) {
                console.log(`✅ Dépense créée avec succès pour la tâche ${taskId}`);
                return {
                    success: true,
                    message: 'Dépense créée avec succès',
                    data: response.result || response,
                    result: response.result
                };
            } else {
                console.warn('⚠️ Réponse inattendue pour la création de dépense:', response);
                return {
                    success: false,
                    message: response?.message || 'Erreur lors de la création de la dépense'
                };
            }

        } catch (error) {
            console.error(`❌ Erreur création dépense pour tâche ${taskId}:`, error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue lors de la création'
            };
        }
    },
    async getUpdatedTaskTimerState(taskId: number): Promise<{
        timer_start?: string | false;
        timer_pause?: string | false
    } | null> {
        try {
            const response = await this.getTaskTimerState(taskId);
            if (response.success && response.data) {
                return {
                    timer_start: response.data.timer_start || false,
                    timer_pause: response.data.timer_pause || false
                };
            }
            return null;
        } catch (error) {
            console.error('❌ Erreur récupération état timer:', error);
            return null;
        }
    },
    async startTaskTimer(taskId: number): Promise<{
        success: boolean;
        message?: string;
        data?: any;
        timerState?: any
    }> {
        try {
            console.log(`⏰ Démarrage du timer pour la tâche ${taskId}...`);

            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            const payload = {
                "operation": "rpc",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "model": "project.task",
                "method": "action_timer_start_button",
                "args": [[taskId]]
            };

            const apiUrl = getCurrentApiUrl();
            console.log('🔗 URL API Timer:', apiUrl);
            console.log('📤 Payload Timer Start:', JSON.stringify(payload, null, 2));

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
            console.log('🔍 Réponse API timer start:', data);

            if (data.success || (!data.error && data.result !== false)) {
                console.log(`✅ Timer démarré pour la tâche ${taskId}`);

                // Récupérer l'état actualisé du timer
                const timerState = await this.getUpdatedTaskTimerState(taskId);

                return {
                    success: true,
                    message: 'Timer démarré avec succès',
                    data: data.result,
                    timerState
                };
            } else {
                console.warn('⚠️ Erreur timer start:', data.message || data.error);
                return {
                    success: false,
                    message: data.message || data.error?.message || 'Erreur lors du démarrage du timer'
                };
            }

        }
        catch (error) {
            console.error(`❌ Erreur démarrage timer tâche ${taskId}:`, error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue lors du démarrage'
            };
        }
    },
    async pauseTaskTimer(taskId: number): Promise<{
        success: boolean;
        message?: string;
        data?: any;
        timerState?: any
    }> {
        try {
            console.log(`⏸️ Pause du timer pour la tâche ${taskId}...`);

            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            const payload = {
                "operation": "rpc",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "model": "project.task",
                "method": "action_timer_pause_button",
                "args": [[taskId]]
            };

            const apiUrl = getCurrentApiUrl();
            console.log('🔗 URL API Timer Pause:', apiUrl);
            console.log('📤 Payload Timer Pause:', JSON.stringify(payload, null, 2));

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
            console.log('🔍 Réponse API timer pause:', data);

            if (data.success || (!data.error && data.result !== false)) {
                console.log(`✅ Timer en pause pour la tâche ${taskId}`);

                // Récupérer l'état actualisé du timer
                const timerState = await this.getUpdatedTaskTimerState(taskId);

                return {
                    success: true,
                    message: 'Timer mis en pause avec succès',
                    data: data.result,
                    timerState
                };
            } else {
                return {
                    success: false,
                    message: data.message || data.error?.message || 'Erreur lors de la pause du timer'
                };
            }

        } catch (error) {
            console.error(`❌ Erreur pause timer tâche ${taskId}:`, error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue lors de la pause'
            };
        }
    },
    async resumeTaskTimer(taskId: number): Promise<{
        success: boolean;
        message?: string;
        data?: any;
        timerState?: any
    }> {
        try {
            console.log(`▶️ Reprise du timer pour la tâche ${taskId}...`);

            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            const payload = {
                "operation": "rpc",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "model": "project.task",
                "method": "action_timer_resume_button",
                "args": [[taskId]]
            };

            const apiUrl = getCurrentApiUrl();
            console.log('🔗 URL API Timer Resume:', apiUrl);
            console.log('📤 Payload Timer Resume:', JSON.stringify(payload, null, 2));

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
            console.log('🔍 Réponse API timer resume:', data);

            if (data.success || (!data.error && data.result !== false)) {
                console.log(`✅ Timer repris pour la tâche ${taskId}`);

                // Récupérer l'état actualisé du timer
                const timerState = await this.getUpdatedTaskTimerState(taskId);

                return {
                    success: true,
                    message: 'Timer repris avec succès',
                    data: data.result,
                    timerState
                };
            } else {
                return {
                    success: false,
                    message: data.message || data.error?.message || 'Erreur lors de la reprise du timer'
                };
            }

        } catch (error) {
            console.error(`❌ Erreur reprise timer tâche ${taskId}:`, error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue lors de la reprise'
            };
        }
    },
    async stopTaskTimer(taskId: number): Promise<{ success: boolean; message?: string; data?: any; timerState?: any }> {
        try {
            console.log(`⏹️ Arrêt du timer pour la tâche ${taskId}...`);

            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            const payload = {
                "operation": "rpc",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "model": "project.task",
                "method": "action_timer_stop_button",
                "args": [[taskId]]
            };

            const apiUrl = getCurrentApiUrl();
            console.log('🔗 URL API Timer Stop:', apiUrl);
            console.log('📤 Payload Timer Stop:', JSON.stringify(payload, null, 2));

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            console.log('📊 Response Status:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ HTTP Error Response:', errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('🔍 Réponse API timer stop complète:', JSON.stringify(data, null, 2));

            // Vérification plus détaillée de la réponse
            if (data.error) {
                console.error('❌ Erreur API:', data.error);
                return {
                    success: false,
                    message: data.error.message || data.message || 'Erreur API lors de l\'arrêt du timer'
                };
            }

            // Accepter plusieurs formats de succès
            if (data.success || (!data.error && data.result !== false)) {
                console.log(`✅ Timer arrêté pour la tâche ${taskId}`);

                // Récupérer l'état actualisé du timer
                const timerState = await this.getUpdatedTaskTimerState(taskId);

                return {
                    success: true,
                    message: 'Timer arrêté avec succès',
                    data: data.result,
                    timerState
                };
            }
            // Parfois Odoo retourne result: false pour certaines actions
            else if (data.result === false && !data.error) {
                console.log(`✅ Timer arrêté (result: false mais pas d'erreur) pour la tâche ${taskId}`);

                // Récupérer l'état actualisé du timer
                const timerState = await this.getUpdatedTaskTimerState(taskId);

                return {
                    success: true,
                    message: 'Timer arrêté avec succès',
                    data: data.result,
                    timerState
                };
            } else {
                console.warn('⚠️ Réponse inattendue:', data);
                return {
                    success: false,
                    message: data.message || 'Format de réponse inattendu lors de l\'arrêt du timer'
                };
            }

        } catch (error) {
            console.error(`❌ Erreur arrêt timer tâche ${taskId}:`, error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue lors de l\'arrêt'
            };
        }
    },
    async stopTaskTimerAlternative(taskId: number): Promise<{ success: boolean; message?: string; data?: any }> {
        try {
            console.log(`⏹️ [ALT] Arrêt du timer pour la tâche ${taskId}...`);

            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            // Essayer avec button_stop au lieu de action_timer_stop_button
            const payload = {
                "operation": "rpc",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "model": "project.task",
                "method": "button_stop", // Alternative method name
                "args": [[taskId]]
            };

            const apiUrl = getCurrentApiUrl();
            console.log('🔗 URL API Timer Stop Alt:', apiUrl);
            console.log('📤 Payload Timer Stop Alt:', JSON.stringify(payload, null, 2));

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
            console.log('🔍 Réponse API timer stop alt:', JSON.stringify(data, null, 2));

            if (data.success || (!data.error && data.result !== false)) {
                console.log(`✅ [ALT] Timer arrêté pour la tâche ${taskId}`);
                return {
                    success: true,
                    message: 'Timer arrêté avec succès (méthode alternative)',
                    data: data.result
                };
            } else {
                return {
                    success: false,
                    message: data.message || data.error?.message || 'Erreur lors de l\'arrêt du timer (alt)'
                };
            }

        } catch (error) {
            console.error(`❌ Erreur arrêt timer alt tâche ${taskId}:`, error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue lors de l\'arrêt (alt)'
            };
        }
    },
    calculateProjectStats(projects: Project[]): ProjectStats {
        if (!Array.isArray(projects)) {
            return {
                totalProjects: 0,
                totalTasks: 0,
                completedTasks: 0,
                inProgressTasks: 0,
                completionRate: 0,
                situationProjects: 0,
                normalProjects: 0,
                totalExpenses: 0,
                expenseCount: 0
            };
        }

        let totalTasks = 0;
        let completedTasks = 0;
        let inProgressTasks = 0;
        let totalExpenses = 0;
        let expenseCount = 0;

        projects.forEach(project => {
            if (project.task_ids && Array.isArray(project.task_ids)) {
                project.task_ids.forEach(task => {
                    totalTasks++;

                    // Comptage des tâches selon l'état
                    if (task.state === '03_approved') {
                        completedTasks++;
                    } else if (task.state === '01_in_progress') {
                        inProgressTasks++;
                    }

                    // Comptage des dépenses
                    if (task.expense_ids && Array.isArray(task.expense_ids)) {
                        task.expense_ids.forEach(expense => {
                            expenseCount++;
                            if (expense.amount && typeof expense.amount === 'number') {
                                totalExpenses += expense.amount;
                            }
                        });
                    }
                });
            }
        });

        return {
            totalProjects: projects.length,
            totalTasks,
            completedTasks,
            inProgressTasks,
            completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
            situationProjects: projects.filter(p => p.project_type === 'situation').length,
            normalProjects: projects.filter(p => p.project_type === 'normaux').length,
            totalExpenses,
            expenseCount
        };
    },
    async insertOrUpdateProject(project: Project): Promise<boolean> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            const timestamp = Date.now();
            await database.runAsync(
                'INSERT OR REPLACE INTO projects (id, data, updated_at) VALUES (?, ?, ?)',
                [project.id, JSON.stringify(project), timestamp]
            );

            console.log(`✅ Projet ${project.id} inséré/mis à jour (WebSocket sync)`);

            // Émettre un événement pour notifier les composants
            projectEventEmitter.emit('projectUpdated', project);

            return true;

        } catch (error) {
            console.error('❌ Erreur sync projet WebSocket:', error);
            return false;
        }
    },
    /**
     * 🗑️ DELETE PROJECT : Supprimer un projet spécifique de SQLite
     */
    async deleteProject(projectId: number): Promise<boolean> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            // ✅ Vérifier d'abord si le projet existe
            const existingProject = await database.getFirstAsync<{ id: number }>(
                'SELECT id FROM projects WHERE id = ?',
                [projectId]
            );

            // Si le projet n'existe pas, retourner false sans émettre l'événement
            if (!existingProject) {
                console.log(`⚠️ Projet ${projectId} déjà supprimé ou n'existe pas`);
                return false;
            }

            // Supprimer le projet par son ID
            await database.runAsync('DELETE FROM projects WHERE id = ?', [projectId]);

            console.log(`✅ Projet ${projectId} supprimé de SQLite`);
            
            // 📢 Émettre un événement UNIQUEMENT si le projet a été supprimé
            projectEventEmitter.emit('projectDeleted', projectId);
            
            return true;

        } catch (error) {
            console.error(`❌ Erreur lors de la suppression du projet ${projectId}:`, error);
            return false;
        }
    },

    /**
     * 🗑️ DELETE TASK : Supprimer une tâche d'un projet dans SQLite
     */
    async deleteTask(projectId: number, taskId: number): Promise<boolean> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            // Charger le projet
            const projectRow = await database.getFirstAsync<{ id: number; data: string }>(
                'SELECT id, data FROM projects WHERE id = ?',
                [projectId]
            );

            if (!projectRow) {
                console.log(`⚠️ Projet ${projectId} non trouvé`);
                return false;
            }

            const project = JSON.parse(projectRow.data) as Project;

            // Vérifier si la tâche existe
            if (!project.task_ids || !project.task_ids.some(t => t.id === taskId)) {
                console.log(`⚠️ Tâche ${taskId} déjà supprimée ou n'existe pas`);
                return false;
            }

            // Retirer la tâche de la liste
            project.task_ids = project.task_ids.filter(t => t.id !== taskId);

            // Sauvegarder le projet mis à jour
            const timestamp = Date.now();
            await database.runAsync(
                'INSERT OR REPLACE INTO projects (id, data, updated_at) VALUES (?, ?, ?)',
                [project.id, JSON.stringify(project), timestamp]
            );

            console.log(`✅ Tâche ${taskId} supprimée du projet ${projectId}`);
            
            // 📢 Émettre un événement UNIQUEMENT si la tâche a été supprimée
            projectEventEmitter.emit('taskDeleted', { projectId, taskId });
            
            return true;

        } catch (error) {
            console.error(`❌ Erreur lors de la suppression de la tâche ${taskId}:`, error);
            return false;
        }
    },

    /**
     * 🗑️ CLEAR PROJECTS : Supprimer tous les projets de la base SQLite
     */
    async clearProjects(): Promise<boolean> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            // Supprimer toutes les données de la table projects
            await database.runAsync('DELETE FROM projects');

            console.log('✅ Tous les projets ont été supprimés de SQLite');
            
            // 📢 Émettre un événement pour notifier toutes les vues
            projectEventEmitter.emit('projectsCleared');
            
            return true;

        } catch (error) {
            console.error('❌ Erreur lors de la suppression des projets:', error);
            return false;
        }
    }
};

// Fonction pour s'abonner aux mises à jour de projets
export const subscribeToProjectUpdates = (callback: (project: Project) => void) => {
    projectEventEmitter.on('projectUpdated', callback);
    return () => projectEventEmitter.off('projectUpdated', callback);
};

// Fonction pour s'abonner à la suppression d'un projet
export const subscribeToProjectDeleted = (callback: (projectId: number) => void) => {
    projectEventEmitter.on('projectDeleted', callback);
    return () => projectEventEmitter.off('projectDeleted', callback);
};

// Fonction pour s'abonner à la suppression d'une tâche
export const subscribeToTaskDeleted = (callback: (data: { projectId: number; taskId: number }) => void) => {
    projectEventEmitter.on('taskDeleted', callback);
    return () => projectEventEmitter.off('taskDeleted', callback);
};

// Fonction pour s'abonner au vidage du cache
export const subscribeToProjectsCleared = (callback: () => void) => {
    projectEventEmitter.on('projectsCleared', callback);
    return () => projectEventEmitter.off('projectsCleared', callback);
};

export default projectService;
