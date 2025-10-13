// WebSocket Service - Geo Lambert Project Management
import { getCurrentWebSocketUrl } from "./config/configService";
import io, { Socket } from "socket.io-client";
import projectService from "@/services/projectService";
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
                            success = await projectService.insertOrUpdateProject(parsedTask);
                            break;
                        case 'deleted':
                            success = await projectService.deleteProject(parsedTask.id);
                            // Ne logger que si la suppression a réellement eu lieu (pas de doublon)
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
                            success = await projectService.insertOrUpdateProject(parsedProject);
                            break;
                        case 'deleted':
                            // ✅ Vérifier si c'est une suppression de tâche ou de projet
                            if (parsedProject.deleted_task_id) {
                                // Suppression d'une tâche individuelle
                                success = await projectService.deleteTask(parsedProject.id, parsedProject.deleted_task_id);
                                if (success) {
                                    console.log(`🗑️ Tâche ${parsedProject.deleted_task_id} supprimée du projet ${parsedProject.id}`);
                                }
                            } else {
                                // Suppression du projet entier
                                success = await projectService.deleteProject(parsedProject.id);
                                if (success) {
                                    console.log(`🗑️ Projet ${parsedProject.id} supprimé (project deleted)`);
                                }
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

        // Nettoyer les canaux publics
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
