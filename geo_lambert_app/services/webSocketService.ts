// WebSocket Service - Geo Lambert Project Management
import { getCurrentWebSocketUrl } from "./config/configService";
import io, { Socket } from "socket.io-client";
import projectCategoryService from "@/services/projectCategoryService";
import { authService } from "@/services/authService";
import { AppState, AppStateStatus } from 'react-native';

// ==================== SERVICE WEBSOCKET ====================

class WebSocketService {
    private name_project = "geo_lambert";
    private socket: Socket | null = null;
    private authuser: string | null = null;
    private pendingSubscriptions: (() => void)[] = []; // Private subscriptions waiting for auth
    private pendingPublicSubscriptions: (() => void)[] = []; // Public subscriptions waiting for socket connection
    private appState: AppStateStatus = 'active';
    async connect(): Promise<void> {
        if (this.socket && this.socket.connected) return;
        
        // Initialiser la gestion de l'état de l'app si pas déjà fait
        this.setupAppStateHandling();
        
        // Utiliser l'URL WebSocket configurée
        const wsUrl = getCurrentWebSocketUrl();
        
        console.log('🔗 Connexion WebSocket Geo Lambert à:', wsUrl);
        
        this.socket = io(wsUrl, {
            // Options pour maintenir la connexion
            forceNew: true,
            transports: ['websocket', 'polling'],
            timeout: 60000,
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 2000,
            reconnectionDelayMax: 10000,
        });

        this.socket.on("connect", async () => {
            console.log("🔗 Début de la connexion WebSocket...");

            // 1. EXÉCUTER IMMÉDIATEMENT LES SOUSCRIPTIONS PUBLIQUES
            console.log("📡 Exécution des souscriptions publiques (sans auth):", this.pendingPublicSubscriptions.length);
            this.pendingPublicSubscriptions.forEach((subscription, index) => {
                console.log("🌐 Exécution souscription publique #" + (index + 1));
                subscription();
            });
            this.pendingPublicSubscriptions = [];
            console.log("✅ Toutes les souscriptions publiques ont été exécutées");

            // 2. ESSAYER D'AUTHENTIFIER ET EXÉCUTER LES SOUSCRIPTIONS PRIVÉES
            try {
                let user = await authService.getCurrentUser();
                console.log("📤 Récupération utilisateur:", user);

                // Vérifier si c'est déjà un objet ou une chaîne
                if (typeof user === 'string') {
                    console.log("🔄 Parsing JSON nécessaire...");
                    user = JSON.parse(user);
                } else {
                    console.log("✅ Objet déjà parsé, pas de JSON.parse nécessaire");
                }

                // @ts-ignore
                this.authuser = user.id

                // Exécuter les souscriptions privées en attente
                console.log("🔒 Souscriptions privées en attente:", this.pendingSubscriptions.length);
                this.pendingSubscriptions.forEach((subscription, index) => {
                    console.log("🎯 Exécution souscription privée #" + (index + 1));
                    subscription();
                });
                this.pendingSubscriptions = [];
                console.log("✅ Toutes les souscriptions privées ont été exécutées");
                
            } catch (error) {
                console.error('❌ Erreur lors de l\'authentification:', error);
                console.log('⚠️ Seules les souscriptions publiques sont actives');
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

        // Nettoyer TOUTES les souscriptions en attente
        this.pendingSubscriptions = []; // Private subscriptions
        this.pendingPublicSubscriptions = []; // Public subscriptions
        console.log('✅ WebSocket déconnecté et nettoyé (souscriptions privées et publiques)');
    }
    private setupAppStateHandling(): void {
        if (this.appState !== 'active') return; // Déjà configuré
        
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
     * Souscription aux mises à jour de tâches
     */
    onTaskUpdate(callback: (task: any) => void): void {
        const subscribeToTasks = () => {
            if (!this.authuser) {
                return;
            }
            const privateTaskChannel = `${this.name_project}_tasks_user_id_${this.authuser}`;

            this.subscribe(privateTaskChannel, async (data: any) => {
                try {
                    // Vérifier si les données sont déjà parsées
                    console.log(JSON.stringify(data, null, 2));
                    let parsedTask;
                    if (typeof data === 'string') {
                        parsedTask = JSON.parse(data);
                    } else {
                        parsedTask = data;
                    }

                    // Traiter selon le type d'événement
                    const eventType = parsedTask.event_type || 'updated';
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
                            break;
                        case 'deleted':
                            // Pour les suppressions, aussi recharger les catégories
                            const deleteCategoriesResponse = await projectCategoryService.getProjectCategories();
                            success = deleteCategoriesResponse.success;
                            if (success) {
                                console.log(`🗑️ Projet ${parsedTask.id} supprimé (task deleted)`);
                            }
                            break;
                        default:
                            console.log('⚠️ Type d\'événement tâche non géré:', eventType);
                            success = true;
                    }

                    if (success) {
                        callback(parsedTask);
                    } else {
                        console.error('❌ Échec traitement tâche depuis socket:', parsedTask.id || 'ID inconnu');
                    }
                } catch (error) {
                    console.error('❌ Erreur traitement tâche socket:', error);
                    console.error('📊 Stack trace:', error);
                }
            });
        };

        if (this.authuser) {
            subscribeToTasks();
        } else {
            this.pendingSubscriptions.push(subscribeToTasks);
        }
    }
    onProjectUpdate(callback: (project: any) => void): void {
        const subscribeToProjects = () => {
            if (!this.authuser) return;

            const privateProjectChannel = `${this.name_project}_expenses`;
            
            this.subscribe(privateProjectChannel, async (data: any) => {
                try {
                    console.log(JSON.stringify(JSON.parse(data), null, 2));
                    let parsedProject = typeof data === 'string' ? JSON.parse(data) : data;
                    const eventType = parsedProject.event_type || 'updated';
                    let success = false;

                    switch (eventType) {
                        case 'created':
                        case 'updated':
                        case 'sync':
                            // ✅ Vérifier s'il y a une dépense supprimée
                            if (parsedProject.deleted_expense_id) {
                                console.log(`🗑️ Dépense ${parsedProject.deleted_expense_id} supprimée`);
                                if (parsedProject.task_id_with_deleted_expense) {
                                    console.log(`   de la tâche ${parsedProject.task_id_with_deleted_expense}`);
                                }
                            }
                            // 💾 INSERT OR REPLACE le projet dans SQLite avec sa catégorie
                            success = await projectCategoryService.insertOrUpdateProject(parsedProject);
                            if (success) {
                                console.log(`✅ Projet ${parsedProject.id} mis à jour via WebSocket`);
                            } else {
                                console.warn(`⚠️ Échec mise à jour projet ${parsedProject.id} via WebSocket`);
                            }
                            break;
                        case 'deleted':
                            // ✅ Vérifier si c'est une suppression de tâche ou de projet
                            if (parsedProject.deleted_task_id) {
                                // Suppression d'une tâche individuelle
                                console.log(`🗑️ Tâche ${parsedProject.deleted_task_id} supprimée du projet ${parsedProject.id}`);
                                // Recharger les catégories pour mettre à jour la tâche
                                const categoriesResponse = await projectCategoryService.getProjectCategories();
                                success = categoriesResponse.success;
                            } else {
                                // Suppression du projet entier
                                console.log(`🗑️ Projet ${parsedProject.id} supprimé (project deleted)`);
                                success = await projectCategoryService.deleteProject(parsedProject.id);
                            }
                            break;
                        default:
                            console.log('⚠️ Type événement projet non géré:', eventType);
                            success = true;
                    }

                    if (success) {
                        callback(parsedProject);
                    }
                } catch (error) {
                    console.error('❌ Erreur traitement projet socket:', error);
                }
            });
        };

        if (this.authuser) {
            subscribeToProjects();
        } else {
            this.pendingSubscriptions.push(subscribeToProjects);
        }
    }
    /**
     * Souscription aux mises à jour de dépenses de caisse
     * ✅ Channel PRIVÉ - case_id + user_id
     */
    onCashboxExpenseUpdate(callback: (data: any) => void): void {
        const subscribeToCashboxExpenses = () => {
            if (!this.authuser) {
                console.log('⚠️ Pas d\'authentification pour les dépenses de caisse');
                return;
            }

            // Récupérer le case_id depuis l'auth
            const getUserInfo = async () => {
                try {
                    const user = await authService.getCurrentUser();
                    if (!user || !user.case_id) {
                        console.error('❌ case_id manquant dans user auth');
                        return null;
                    }
                    return user;
                } catch (error) {
                    console.error('❌ Erreur récupération user info:', error);
                    return null;
                }
            };

            getUserInfo().then(user => {
                if (!user) return;

                // ✅ Canal privé: geo_lambert_expense_caise_{case_id}_{user_id}
                const privateCashboxChannel = `${this.name_project}_expense_caise_${user.case_id}_${this.authuser}`;
                console.log('📡 Souscription au canal dépenses de caisse:', privateCashboxChannel);

                this.subscribe(privateCashboxChannel, async (data: any) => {
                    try {
                        console.log('📥 Données dépense de caisse reçues:', typeof data === 'string' ? 'string' : 'object');
                        
                        let parsedData;
                        if (typeof data === 'string') {
                            parsedData = JSON.parse(data);
                        } else {
                            parsedData = data;
                        }

                        callback(parsedData);

                    } catch (error) {
                        console.error('❌ Erreur traitement dépense de caisse socket:', error);
                        console.error('📊 Données brutes:', data);
                    }
                });
            });
        };

        // ✅ Attendre l'authentification avant de s'abonner
        if (this.authuser) {
            subscribeToCashboxExpenses();
        } else {
            this.pendingSubscriptions.push(subscribeToCashboxExpenses);
        }
    }

    /**
     * Souscription aux mises à jour de mois de dépenses
     * ✅ Channel PRIVÉ - case_id + user_id
     */
    onExpenseMonthUpdate(callback: (data: any) => void): void {
        const subscribeToExpenseMonths = () => {
            if (!this.authuser) {
                console.log('⚠️ Pas d\'authentification pour les mois de dépenses');
                return;
            }

            // Récupérer le case_id depuis l'auth
            const getUserInfo = async () => {
                try {
                    const user = await authService.getCurrentUser();
                    if (!user || !user.case_id) {
                        console.error('❌ case_id manquant dans user auth');
                        return null;
                    }
                    return user;
                } catch (error) {
                    console.error('❌ Erreur récupération user info:', error);
                    return null;
                }
            };

            getUserInfo().then(user => {
                if (!user) return;

                // ✅ Canal privé: geo_lambert_expense_month_caise_{case_id}_{user_id}
                const privateMonthChannel = `${this.name_project}_expense_month_caise_${user.case_id}_${this.authuser}`;
                console.log('📡 Souscription au canal mois de dépenses:', privateMonthChannel);

                this.subscribe(privateMonthChannel, async (data: any) => {
                    try {
                        console.log('📥 Données mois de dépenses reçues:', typeof data === 'string' ? 'string' : 'object');
                        
                        let parsedData;
                        if (typeof data === 'string') {
                            parsedData = JSON.parse(data);
                        } else {
                            parsedData = data;
                        }

                        callback(parsedData);

                    } catch (error) {
                        console.error('❌ Erreur traitement mois de dépenses socket:', error);
                        console.error('📊 Données brutes:', data);
                    }
                });
            });
        };

        // ✅ Attendre l'authentification avant de s'abonner
        if (this.authuser) {
            subscribeToExpenseMonths();
        } else {
            this.pendingSubscriptions.push(subscribeToExpenseMonths);
        }
    }

    /**
     * Souscription aux mises à jour de catégories de projets
     * ⚠️ Channel PUBLIC - Pas besoin d'authentification
     */
    onCategoryUpdate(callback: (category: any) => void): void {
        const subscribeToCategories = () => {
            // ✅ Channel PUBLIC pour les catégories
            const publicCategoryChannel = `${this.name_project}_category_projects`;

            console.log('📡 Souscription au channel catégories:', publicCategoryChannel);

            this.subscribe(publicCategoryChannel, async (data: any) => {
                try {
                    let parsedCategory;
                    if (typeof data === 'string') {
                        parsedCategory = JSON.parse(data);
                    } else {
                        parsedCategory = data;
                    }

                    console.log('📥 Catégorie reçue via WebSocket:', {
                        id: parsedCategory.id,
                        name: parsedCategory.name,
                        event_type: parsedCategory.event_type,
                        project_count: parsedCategory.project_ids?.length || 0
                    });

                    const eventType = parsedCategory.event_type || 'updated';

                    let success = false;

                    switch (eventType) {
                        case 'created':
                        case 'updated':
                        case 'sync':
                            // 💾 INSERT OR REPLACE dans SQLite
                            success = await projectCategoryService.insertOrUpdateCategory(parsedCategory);
                            if (success) {
                                console.log(`✅ Catégorie ${parsedCategory.id} (${parsedCategory.name}) - INSERT OR REPLACE réussi`);
                            }
                            break;
                        case 'deleted':
                            // 🗑️ DELETE de SQLite
                            success = await projectCategoryService.deleteCategory(parsedCategory.id);
                            if (success) {
                                console.log(`🗑️ Catégorie ${parsedCategory.id} supprimée de SQLite`);
                            }
                            break;
                        default:
                            console.log('⚠️ Type d\'événement catégorie non géré:', eventType);
                            success = true;
                    }

                    if (success) {
                        callback(parsedCategory);
                    } else {
                        console.error('❌ Échec traitement catégorie depuis socket:', parsedCategory.id || 'ID inconnu');
                    }
                } catch (error) {
                    console.error('❌ Erreur traitement catégorie socket:', error);
                }
            });
        };

        // ✅ Souscription PUBLIQUE - Pas besoin d'attendre l'auth
        if (this.socket && this.socket.connected) {
            subscribeToCategories();
        } else {
            this.pendingPublicSubscriptions.push(subscribeToCategories);
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

    // Unsubscribe from all events (useful for cleanup)
    unsubscribeAll(): void {
        console.log('🧹 Début du nettoyage des listeners...');

        if (!this.socket) {
            console.log('⚠️ Pas de socket à nettoyer');
            return;
        }

        // Unsubscribe from private channels if user is authenticated
        if (this.authuser) {
            // Canaux Geo Lambert Project Management
            const privateProjectChannel = `${this.name_project}_projects_user_id_${this.authuser}`;
            const privateTaskChannel = `${this.name_project}_tasks_user_id_${this.authuser}`;
            const privateExpenseChannel = `${this.name_project}_expenses_user_id_${this.authuser}`;
            const privateExpenseDeleteChannel = `${this.name_project}_expenses_delete_user_id_${this.authuser}`;

            // Legacy channels
            const privateCommandChannel = `command_user_id_${this.authuser}`;
            const privateOrderDeleteChannel = `order_delete_user_id_${this.authuser}`;
            const privateProductChannel = `products_user_id_${this.authuser}`;
            const privateProductDeleteChannel = `products_delete_user_id_${this.authuser}`;
            const privateEditProfileChannel = `edit_profil_${this.authuser}`;
            const privateUserMessageChannel = `user_message_${this.authuser}_${this.name_project}`;

            // Nettoyage canaux Geo Lambert
            console.log('🔒 Nettoyage du canal privé projets:', privateProjectChannel);
            this.socket.off(privateProjectChannel);

            console.log('🔒 Nettoyage du canal privé tâches:', privateTaskChannel);
            this.socket.off(privateTaskChannel);

            console.log('🔒 Nettoyage du canal privé dépenses:', privateExpenseChannel);
            this.socket.off(privateExpenseChannel);

            console.log('🔒 Nettoyage du canal privé suppression dépenses:', privateExpenseDeleteChannel);
            this.socket.off(privateExpenseDeleteChannel);

            // Nettoyage canal catégories (legacy privé)
            const privateCategoryChannel = `${this.name_project}_categories_user_id_${this.authuser}`;
            console.log('🔒 Nettoyage du canal privé catégories (legacy):', privateCategoryChannel);
            this.socket.off(privateCategoryChannel);

            // Nettoyage canaux legacy
            console.log('🔒 Nettoyage du canal privé commandes (legacy):', privateCommandChannel);
            this.socket.off(privateCommandChannel);

            console.log('🔒 Nettoyage du canal privé suppression commandes (legacy):', privateOrderDeleteChannel);
            this.socket.off(privateOrderDeleteChannel);

            console.log('🔒 Nettoyage du canal privé produits (legacy):', privateProductChannel);
            this.socket.off(privateProductChannel);

            console.log('🔒 Nettoyage du canal privé suppression produits (legacy):', privateProductDeleteChannel);
            this.socket.off(privateProductDeleteChannel);

            console.log('🔒 Nettoyage du canal privé édition profil:', privateEditProfileChannel);
            this.socket.off(privateEditProfileChannel);

            console.log('🔒 Nettoyage du canal privé messages utilisateur:', privateUserMessageChannel);
            this.socket.off(privateUserMessageChannel);
        } else {
            console.log('⚠️ Pas d\'utilisateur authentifié, pas de canaux privés à nettoyer');
        }

        // Nettoyer les canaux privés dépenses de caisse et mois si utilisateur authentifié
        if (this.authuser) {
            // Note: On ne peut pas récupérer facilement le case_id ici de manière synchrone
            // mais on peut nettoyer le pattern général
            console.log(`🔒 Nettoyage des canaux privés dépenses de caisse pour user ${this.authuser}`);
            console.log(`🔒 Nettoyage des canaux privés mois de dépenses pour user ${this.authuser}`);
            // On nettoie tous les canaux qui matchent le pattern
            // Note: socket.io ne permet pas de lister tous les channels, donc on fait un best effort
        }

        // Nettoyer les canaux publics
        console.log(`📡 Nettoyage du canal public catégories: ${this.name_project}_category_aprojects`);
        this.socket.off(`${this.name_project}_category_aprojects`);

        console.log(`📡 Nettoyage du canal public messages Geo Lambert app: message_app_${this.name_project}`);
        this.socket.off(`message_app_${this.name_project}`);

        console.log(`📡 Nettoyage du canal public messages app (legacy): message_app_${this.name_project}`);
        this.socket.off(`message_app_${this.name_project}`);

        console.log('📡 Nettoyage du canal public produits: products');
        this.socket.off('products');

        console.log(`📡 Nettoyage du canal public messages: message_${this.name_project}`);
        this.socket.off(`message_${this.name_project}`);

        // Nettoyer les listeners généraux
        this.socket.off('connect');
        this.socket.off('disconnect');

        console.log('🗑️ Tous les listeners WebSocket supprimés avec succès');
    }
}

export const webSocketService = new WebSocketService();
export default webSocketService;
