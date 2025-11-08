// WebSocket Service - Geo Lambert Project Management - CANAL UNIFIÉ
import { getCurrentWebSocketUrl } from "./config/configService";
import io, { Socket } from "socket.io-client";
import projectCategoryService, { emitCategoriesUpdate } from "@/services/projectCategoryService";
import { authService } from "@/services/authService";
import { AppState, AppStateStatus } from 'react-native';

// ==================== SERVICE WEBSOCKET UNIFIÉ ====================

class WebSocketService {
    private name_project = "geo_lambert";
    private socket: Socket | null = null;
    private authuser: string | null = null;
    private pendingSubscriptions: (() => void)[] = [];
    private appState: AppStateStatus = 'active';

    async connect(): Promise<void> {
        if (this.socket && this.socket.connected) return;
        
        this.setupAppStateHandling();
        
        const wsUrl = getCurrentWebSocketUrl();
        
        console.log('🔗 Connexion WebSocket Geo Lambert à:', wsUrl);
        
        this.socket = io(wsUrl, {
            forceNew: true,
            transports: ['websocket', 'polling'],
            timeout: 60000,
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 2000,
            reconnectionDelayMax: 10000,
        });

        this.socket.on("connect", async () => {
            console.log("🔗 Connexion WebSocket établie");

            try {
                let user = await authService.getCurrentUser();
                console.log("📤 Récupération utilisateur:", user);

                if (typeof user === 'string') {
                    user = JSON.parse(user);
                }

                // @ts-ignore
                this.authuser = user.id

                console.log(`✅ User authentifié: ${this.authuser}`);
                
                // Exécuter les souscriptions en attente
                console.log("🔒 Souscriptions en attente:", this.pendingSubscriptions.length);
                this.pendingSubscriptions.forEach((subscription, index) => {
                    console.log("🎯 Exécution souscription #" + (index + 1));
                    subscription();
                });
                this.pendingSubscriptions = [];
                console.log("✅ Toutes les souscriptions ont été exécutées");
                
            } catch (error) {
                console.error('❌ Erreur lors de l\'authentification:', error);
            }
        });

        this.socket.on("disconnect", async (reason) => {
            console.log("🔌 WebSocket déconnecté:", reason);
        });

        this.socket.on(`connect_error_${this.name_project}`, (err) => {
            console.error("❌ Erreur connexion WS:", err.message);
        });
    }

    disconnect(): void {
        this.socket?.disconnect();
        this.socket = null;
        this.authuser = null;
        this.pendingSubscriptions = [];
        console.log('✅ WebSocket déconnecté et nettoyé');
    }

    private setupAppStateHandling(): void {
        if (this.appState !== 'active') return;
        
        console.log('📱 Configuration de la gestion d\'état de l\'app...');
        
        AppState.addEventListener('change', this.handleAppStateChange);
        this.appState = AppState.currentState;
        
        console.log('✅ Gestion d\'état de l\'app activée, état actuel:', this.appState);
    }

    private handleAppStateChange = (nextAppState: AppStateStatus) => {
        this.appState = nextAppState;
    };

    subscribe(event: string, callback: (msg: any) => void): void {
        this.socket?.on(event, callback);
    }

    /**
     * 🔥 CANAL UNIFIÉ: Souscription au canal unique qui reçoit TOUT
     * geo_lambert_category_projects_{user_id}
     * 
     * Ce canal reçoit:
     * - Les catégories (model: 'project.category')
     * - Les projets (model: 'project.project')
     * - Les tâches (model: 'project.task')
     */
    onUnifiedChannelUpdate(callbacks: {
        onCategoryUpdate?: (category: any) => void;
        onProjectUpdate?: (project: any) => void;
        onTaskUpdate?: (task: any) => void;
    }): void {
        const subscribeToUnifiedChannel = () => {
            if (!this.authuser) {
                console.log('⚠️ Pas d\'authentification pour le canal unifié');
                return;
            }

            // 🔥 CANAL UNIFIÉ
            const unifiedChannel = `${this.name_project}_category_projects_${this.authuser}`;
            
            console.log('📡 Souscription au canal unifié:', unifiedChannel);

            this.subscribe(unifiedChannel, async (data: any) => {
                try {
                    // Parser les données si nécessaire
                    let parsedData;
                    if (typeof data === 'string') {
                        parsedData = JSON.parse(data);
                    } else {
                        parsedData = data;
                    }

                    // ✅ Vérification robuste du champ model
                    const model = parsedData.model || parsedData.Model || parsedData.MODEL;
                    const eventType = parsedData.event_type || parsedData.eventType || 'updated';
                    const id = parsedData.id;
                    const name = parsedData.name || parsedData.display_name || parsedData.displayName || 'Unknown';

                    console.log('📥 Données reçues sur canal unifié:', {
                        model: model,
                        event_type: eventType,
                        id: id,
                        name: name
                    });

                    // ⚠️ Si le model est undefined, logger toutes les données pour debug
                    if (!model) {
                        console.error('❌ Modèle UNDEFINED reçu! Données complètes:', JSON.stringify(parsedData, null, 2));
                        console.error('🔍 Clés disponibles:', Object.keys(parsedData));
                        console.warn('⚠️ Modèle inconnu reçu: undefined - Ignoring message');
                        return; // ✅ Ignorer le message au lieu de le traiter
                    }

                    // Router selon le modèle
                    switch (model) {
                        case 'project.category':
                            if (callbacks.onCategoryUpdate) {
                                await this.handleCategoryUpdate(parsedData, callbacks.onCategoryUpdate);
                            }
                            break;
                        
                        case 'project.project':
                            if (callbacks.onProjectUpdate) {
                                await this.handleProjectUpdate(parsedData, callbacks.onProjectUpdate);
                            }
                            break;
                        
                        case 'project.task':
                            if (callbacks.onTaskUpdate) {
                                await this.handleTaskUpdate(parsedData, callbacks.onTaskUpdate);
                            }
                            break;
                        
                        default:
                            console.warn('⚠️ Modèle inconnu reçu:', model);
                            console.log('📦 Payload complet:', JSON.stringify(parsedData, null, 2));
                    }

                } catch (error) {
                    console.error('❌ Erreur traitement message canal unifié:', error);
                    console.error('📦 Données brutes:', data);
                    console.error('🔍 Type de data:', typeof data);
                }
            });
        };

        // Attendre l'authentification avant de s'abonner
        if (this.authuser) {
            subscribeToUnifiedChannel();
        } else {
            this.pendingSubscriptions.push(subscribeToUnifiedChannel);
        }
    }

    /**
     * 📂 Handler pour les mises à jour de catégories
     */
    private async handleCategoryUpdate(categoryData: any, callback: (category: any) => void): Promise<void> {
        const eventType = categoryData.event_type || 'updated';
        let success = false;

        switch (eventType) {
            case 'created':
            case 'updated':
            case 'sync':
                success = await projectCategoryService.insertOrUpdateCategory(categoryData);
                if (success) {
                    console.log(`✅ Catégorie ${categoryData.id} (${categoryData.name}) mise à jour`);
                }
                break;
            
            case 'deleted':
                success = await projectCategoryService.deleteCategory(categoryData.id);
                if (success) {
                    console.log(`🗑️ Catégorie ${categoryData.id} supprimée de SQLite`);
                    // 🔄 Recharger et émettre les catégories mises à jour
                    const response = await projectCategoryService.getProjectCategories();
                    if (response.success && response.result) {
                        emitCategoriesUpdate(response.result);
                        console.log('✅ Vue mise à jour après suppression de la catégorie');
                        return; // Sortir sans appeler callback plus bas
                    }
                }
                break;
            
            default:
                console.log('⚠️ Type d\'événement catégorie non géré:', eventType);
                success = true;
        }

        if (success) {
            callback(categoryData);
        }
    }

    /**
     * 📦 Handler pour les mises à jour de projets
     */
    private async handleProjectUpdate(projectData: any, callback: (project: any) => void): Promise<void> {
        const eventType = projectData.event_type || 'updated';
        let success = false;

        switch (eventType) {
            case 'created':
            case 'updated':
            case 'sync':
                // Vérifier s'il y a une tâche supprimée
                if (projectData.deleted_task_id) {
                    console.log(`🗑️ Tâche ${projectData.deleted_task_id} supprimée du projet ${projectData.id}`);
                }
                
                // Vérifier s'il y a une dépense supprimée
                if (projectData.deleted_expense_id) {
                    console.log(`🗑️ Dépense ${projectData.deleted_expense_id} supprimée`);
                    if (projectData.task_id_with_deleted_expense) {
                        console.log(`   de la tâche ${projectData.task_id_with_deleted_expense}`);
                    }
                }
                
                success = await projectCategoryService.insertOrUpdateProject(projectData);
                if (success) {
                    console.log(`✅ Projet ${projectData.id} mis à jour via WebSocket`);
                }
                break;
            
            case 'deleted':
                success = await projectCategoryService.deleteProject(projectData.id);
                if (success) {
                    console.log(`🗑️ Projet ${projectData.id} supprimé de SQLite`);
                    // 🔄 Recharger et émettre les catégories mises à jour
                    const response = await projectCategoryService.getProjectCategories();
                    if (response.success && response.result) {
                        emitCategoriesUpdate(response.result);
                        console.log('✅ Vue mise à jour après suppression du projet');
                        return; // Sortir sans appeler callback plus bas
                    }
                }
                break;
            
            default:
                console.log('⚠️ Type d\'événement projet non géré:', eventType);
                success = true;
        }

        if (success) {
            callback(projectData);
        }
    }

    /**
     * ✅ Handler pour les mises à jour de tâches
     */
    private async handleTaskUpdate(taskData: any, callback: (task: any) => void): Promise<void> {
        const eventType = taskData.event_type || 'updated';
        let success = false;

        switch (eventType) {
            case 'created':
            case 'updated':
            case 'sync':
            case 'started':
            case 'stopped':
            case 'state_changed':
                // Recharger les catégories depuis SQLite pour avoir les dernières données
                const categoriesResponse = await projectCategoryService.getProjectCategories();
                success = categoriesResponse.success;
                if (success) {
                    console.log(`✅ Tâche ${taskData.id} mise à jour`);
                }
                break;
            
            case 'deleted':
                // Pour les tâches, on recharge juste les catégories
                const deleteResponse = await projectCategoryService.getProjectCategories();
                success = deleteResponse.success;
                if (success && deleteResponse.result) {
                    emitCategoriesUpdate(deleteResponse.result);
                    console.log(`🗑️ Tâche ${taskData.id} supprimée - Vue mise à jour`);
                    return; // Sortir sans appeler callback plus bas
                }
                break;
            
            default:
                console.log('⚠️ Type d\'événement tâche non géré:', eventType);
                success = true;
        }

        if (success) {
            callback(taskData);
        }
    }

    /**
     * 👤 Souscription aux mises à jour du profil utilisateur et de l'authentification
     * 🔥 UTILISE AUSSI LE CANAL UNIFIÉ
     */
    onUserAuthUpdate(callback: (userData: any) => void): void {
        const subscribeToUserAuth = () => {
            if (!this.authuser) {
                console.log('⚠️ Pas d\'authentification pour les mises à jour utilisateur');
                return;
            }

            // 🔥 Réutiliser le canal unifié
            const unifiedChannel = `${this.name_project}_category_projects_${this.authuser}`;
            
            console.log('📡 Souscription aux mises à jour utilisateur sur canal unifié:', unifiedChannel);

            this.subscribe(unifiedChannel, async (data: any) => {
                try {
                    let parsedData;
                    if (typeof data === 'string') {
                        parsedData = JSON.parse(data);
                    } else {
                        parsedData = data;
                    }

                    // Filtrer seulement les messages de type user
                    if (parsedData.model === 'res.users') {
                        console.log('👤 Données utilisateur reçues via WebSocket');
                        
                        console.log('📥 Mise à jour profil utilisateur:', {
                            id: parsedData.id,
                            name: parsedData.display_name || parsedData.name,
                            event_type: parsedData.event_type || 'updated',
                            case_id: parsedData.case_id,
                            balance: parsedData.balance
                        });

                        callback(parsedData);
                    }

                } catch (error) {
                    console.error('❌ Erreur traitement mise à jour utilisateur:', error);
                }
            });
        };

        if (this.authuser) {
            subscribeToUserAuth();
        } else {
            this.pendingSubscriptions.push(subscribeToUserAuth);
        }
    }

    /**
     * 💰 Souscription aux mises à jour de dépenses de caisse
     * 🔥 UTILISE AUSSI LE CANAL UNIFIÉ
     */
    onCashboxExpenseUpdate(callback: (data: any) => void): void {
        const subscribeToCashboxExpenses = () => {
            if (!this.authuser) {
                console.log('⚠️ Pas d\'authentification pour les dépenses de caisse');
                return;
            }

            // 🔥 Réutiliser le canal unifié
            const unifiedChannel = `${this.name_project}_category_projects_${this.authuser}`;
            
            console.log('📡 Souscription aux dépenses de caisse sur canal unifié:', unifiedChannel);

            this.subscribe(unifiedChannel, async (data: any) => {
                try {
                    let parsedData;
                    if (typeof data === 'string') {
                        parsedData = JSON.parse(data);
                    } else {
                        parsedData = data;
                    }

                    // Filtrer seulement les messages de type dépense de caisse
                    if (parsedData.model === 'hr.expense.account.move') {
                        console.log('💰 Données dépense de caisse reçues via WebSocket');
                        callback(parsedData);
                    }

                } catch (error) {
                    console.error('❌ Erreur traitement dépense de caisse:', error);
                }
            });
        };

        if (this.authuser) {
            subscribeToCashboxExpenses();
        } else {
            this.pendingSubscriptions.push(subscribeToCashboxExpenses);
        }
    }

    /**
     * 📅 Souscription aux mises à jour de mois de dépenses
     * 🔥 UTILISE AUSSI LE CANAL UNIFIÉ
     */
    onExpenseMonthUpdate(callback: (data: any) => void): void {
        const subscribeToExpenseMonths = () => {
            if (!this.authuser) {
                console.log('⚠️ Pas d\'authentification pour les mois de dépenses');
                return;
            }

            // 🔥 Réutiliser le canal unifié
            const unifiedChannel = `${this.name_project}_category_projects_${this.authuser}`;
            
            console.log('📡 Souscription aux mois de dépenses sur canal unifié:', unifiedChannel);

            this.subscribe(unifiedChannel, async (data: any) => {
                try {
                    let parsedData;
                    if (typeof data === 'string') {
                        parsedData = JSON.parse(data);
                    } else {
                        parsedData = data;
                    }

                    // Filtrer seulement les messages de type mois de dépenses
                    if (parsedData.model === 'hr.expense.month') {
                        console.log('📅 Données mois de dépenses reçues via WebSocket');
                        callback(parsedData);
                    }

                } catch (error) {
                    console.error('❌ Erreur traitement mois de dépenses:', error);
                }
            });
        };

        if (this.authuser) {
            subscribeToExpenseMonths();
        } else {
            this.pendingSubscriptions.push(subscribeToExpenseMonths);
        }
    }

    onConnectionStatusChange(callback: (connected: boolean) => void): void {
        this.socket?.on("connect", async () => {
            callback(true);
            console.log("Connected!");
        });
        this.socket?.on("disconnect", async () => {
            callback(false);
        });
    }

    unsubscribeAll(): void {
        console.log('🧹 Début du nettoyage des listeners...');

        if (!this.socket) {
            console.log('⚠️ Pas de socket à nettoyer');
            return;
        }

        if (this.authuser) {
            // 🔥 Nettoyer LE canal unifié
            const unifiedChannel = `${this.name_project}_category_projects_${this.authuser}`;
            console.log('🔥 Nettoyage du canal unifié:', unifiedChannel);
            this.socket.off(unifiedChannel);
        } else {
            console.log('⚠️ Pas d\'utilisateur authentifié, pas de canal à nettoyer');
        }

        // Nettoyer les listeners généraux
        this.socket.off('connect');
        this.socket.off('disconnect');

        console.log('🗑️ Tous les listeners WebSocket supprimés avec succès');
    }
}

export const webSocketService = new WebSocketService();
export default webSocketService;
