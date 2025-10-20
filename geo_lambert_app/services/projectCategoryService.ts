// ProjectCategoryService - Service GLOBAL pour la gestion des catégories de projets ET toutes les actions
import {getStoredCredentials, authService} from "./authService";
import {getCurrentApiUrl, EXPENSE_PAYLOADS} from "./config/configService";
import * as SQLite from 'expo-sqlite';
import {EventEmitter} from 'events';
import { MessageFollower } from './types/commonTypes';

// Event Emitter pour les mises à jour en temps réel
const categoryEventEmitter = new EventEmitter();

// 🔒 Flags pour éviter les boucles infinies et conflits de transactions
let isBackgroundRefreshing = false;
let lastUpdateTimestamp = 0;
let refreshQueue: Promise<void> | null = null;

// ==================== FILTRAGE PAR VISIBILITÉ ====================

/**
 * 🔐 Vérifie si un utilisateur peut voir un projet selon privacy_visibility
 * 
 * Règles de visibilité:
 * - privacy_visibility non défini (null/false) → ✅ Visible par TOUS
 * - privacy_visibility = "followers" → 🔒 Visible seulement par les followers (message_follower_ids)
 * - privacy_visibility = "portal" → ✅ Visible par TOUS
 * - privacy_visibility = "employee" → ✅ Visible par TOUS
 * 
 * @param project Le projet à vérifier
 * @param userPartnerId Le partner_id de l'utilisateur connecté
 * @returns true si l'utilisateur peut voir le projet, false sinon
 */
const canUserViewProject = (project: Project, userPartnerId: number | undefined): boolean => {
    // Si privacy_visibility n'est pas défini ou vide, le projet est visible par tous
    if (!project.privacy_visibility) {
        return true;
    }

    // 🔒 CAS SPÉCIAL: privacy_visibility = "followers"
    // → Seulement les utilisateurs dans message_follower_ids peuvent voir le projet
    if (project.privacy_visibility === 'followers') {
        // Si pas de partner_id pour l'utilisateur, pas d'accès
        if (!userPartnerId) {
            console.log(`🔒 Projet ${project.id} (${project.name}) - Accès refusé: pas de partner_id utilisateur`);
            return false;
        }

        // 🔍 Debug: Afficher la structure complète des followers
        if (project.message_follower_ids) {
            console.log(`🔍 Projet ${project.id} - Followers data:`, JSON.stringify(project.message_follower_ids, null, 2));
        }

        // Si pas de followers définis, l'utilisateur n'a pas accès
        if (!project.message_follower_ids || !Array.isArray(project.message_follower_ids) || project.message_follower_ids.length === 0) {
            console.log(`🔒 Projet ${project.id} (${project.name}) - Accès refusé: privacy=followers mais aucun follower`);
            return false;
        }

        // Vérifier si le partner_id de l'utilisateur est dans la liste des followers
        // ⚠️ IMPORTANT: partner_id est un ARRAY avec un objet dedans!
        const isFollower = project.message_follower_ids.some(follower => {
            console.log(`🔍 Follower data:`, JSON.stringify(follower, null, 2));
            
            // follower.partner_id est un ARRAY: [{id: X, name: "...", display_name: "..."}]
            if (!follower.partner_id || !Array.isArray(follower.partner_id) || follower.partner_id.length === 0) {
                console.log(`⚠️ Follower sans partner_id valide`);
                return false;
            }
            
            // Prendre le premier (et unique) élément du array
            const partnerData = follower.partner_id[0];
            console.log(`🔍 Partner data:`, JSON.stringify(partnerData, null, 2), `- User partner_id: ${userPartnerId}`);
            return partnerData && partnerData.id === userPartnerId;
        });

        if (!isFollower) {
            console.log(`🔒 Projet ${project.id} (${project.name}) - Accès refusé: utilisateur (partner_id=${userPartnerId}) n'est pas follower`);
            return false;
        }

        console.log(`✅ Projet ${project.id} (${project.name}) - Accès autorisé: utilisateur est follower`);
        return true;
    }

    // ✅ AUTRES CAS: "portal", "employee", ou toute autre valeur
    // → Ces projets sont VISIBLES PAR TOUS (pas de filtrage)
    return true;
};

/**
 * 🔐 Filtre les projets d'une catégorie selon la visibilité
 * @param category La catégorie avec ses projets
 * @param userPartnerId Le partner_id de l'utilisateur connecté
 * @returns Une nouvelle catégorie avec seulement les projets visibles
 */
const filterCategoryProjects = (category: ProjectCategory, userPartnerId: number | undefined): ProjectCategory => {
    if (!category.project_ids || !Array.isArray(category.project_ids)) {
        return category;
    }

    const filteredProjects = category.project_ids.filter(project => canUserViewProject(project, userPartnerId));

    return {
        ...category,
        project_ids: filteredProjects
    };
};

/**
 * 🔐 Filtre toutes les catégories selon la visibilité des projets
 * @param categories Liste des catégories
 * @returns Liste des catégories filtrées
 */
const filterCategoriesByVisibility = async (categories: ProjectCategory[]): Promise<ProjectCategory[]> => {
    try {
        // Récupérer l'utilisateur actuel pour obtenir son partner_id
        const currentUser = await authService.getCurrentUser();
        const userPartnerId = currentUser?.partner_id;

        console.log(`🔐 Filtrage par visibilité - Utilisateur:`, {
            userId: currentUser?.id,
            partnerId: userPartnerId,
            displayName: currentUser?.display_name
        });

        if (!userPartnerId) {
            console.warn('⚠️ Partner ID utilisateur introuvable - Filtrage strict appliqué');
            
            // 🚨 COMPORTEMENT STRICT: Si pas de partner_id, on filtre TOUS les projets "followers"
            // On garde seulement les projets sans privacy_visibility ou avec "portal"/"employee"
            const strictFilteredCategories = categories.map(category => {
                if (!category.project_ids || !Array.isArray(category.project_ids)) {
                    return category;
                }

                const visibleProjects = category.project_ids.filter(project => {
                    // Si privacy_visibility = "followers", on REFUSE (pas de partner_id = pas d'accès)
                    if (project.privacy_visibility === 'followers') {
                        console.log(`🔒 Projet ${project.id} (${project.name}) - Accès refusé: pas de partner_id utilisateur`);
                        return false;
                    }
                    // Autres cas: visible
                    return true;
                });

                return {
                    ...category,
                    project_ids: visibleProjects
                };
            });

            const totalBefore = categories.reduce((sum, cat) => sum + (cat.project_ids?.length || 0), 0);
            const totalAfter = strictFilteredCategories.reduce((sum, cat) => sum + (cat.project_ids?.length || 0), 0);
            console.log(`🔐 Filtrage strict: ${totalAfter}/${totalBefore} projets visibles (sans partner_id)`);

            return strictFilteredCategories;
        }

        console.log(`🔐 Filtrage des projets pour l'utilisateur (partner_id=${userPartnerId})...`);

        // Filtrer chaque catégorie
        const filteredCategories = categories.map(category => filterCategoryProjects(category, userPartnerId));

        // Compter les projets avant/après filtrage
        const totalProjectsBefore = categories.reduce((sum, cat) => sum + (cat.project_ids?.length || 0), 0);
        const totalProjectsAfter = filteredCategories.reduce((sum, cat) => sum + (cat.project_ids?.length || 0), 0);
        const filteredCount = totalProjectsBefore - totalProjectsAfter;

        if (filteredCount > 0) {
            console.log(`🔐 ${filteredCount} projet(s) filtré(s) (privacy_visibility=followers)`);
            console.log(`📊 Total projets visibles: ${totalProjectsAfter}/${totalProjectsBefore}`);
        } else {
            console.log(`✅ Tous les projets sont visibles pour cet utilisateur`);
        }

        return filteredCategories;

    } catch (error) {
        console.error('❌ Erreur lors du filtrage par visibilité:', error);
        
        // 🚨 EN CAS D'ERREUR: Appliquer le filtrage strict (sécurisé)
        // On filtre TOUS les projets "followers" car on ne peut pas vérifier l'accès
        const strictFilteredCategories = categories.map(category => {
            if (!category.project_ids || !Array.isArray(category.project_ids)) {
                return category;
            }

            const visibleProjects = category.project_ids.filter(project => {
                if (project.privacy_visibility === 'followers') {
                    console.log(`🔒 Projet ${project.id} - Accès refusé: erreur de filtrage`);
                    return false;
                }
                return true;
            });

            return {
                ...category,
                project_ids: visibleProjects
            };
        });

        return strictFilteredCategories;
    }
};

// SQLite Database
let db: SQLite.SQLiteDatabase | null = null;

// Initialize Database
const initDatabase = async () => {
    if (db) return db;

    try {
        db = await SQLite.openDatabaseAsync('geo_lambert.db');

        // Create project_categories table
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS project_categories
            (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);

        console.log('✅ Project categories table initialized');
        return db;
    } catch (error) {
        console.error('❌ Error initializing project categories table:', error);
        throw error;
    }
};

// ==================== INTERFACES ====================

export interface ProjectTask {
    id: number;
    name: string;
    state: string;
    partner_id?: [number, string] | false;
    user_ids?: Array<{ id: number; name: string; display_name?: string }>;
    expense_ids?: Array<{
        id: number;
        balance?: number;
        solde_amount: number;
        amount?: number;
        expense_move_type?: string;
        name?: string;
        date: string;
        expense_date?: string;
        expense_type_id?: Array<{ id: number; name: string; display_name?: string }>;
        expense_category_id?: Array<{ id: number; name: string; display_name?: string }>;
        project_id?: [number, string];
        task_id?: [number, string];
        currency_id?: [number, string];
        display_name?: string;
        description?: string | false;
    }>;
    timesheet_ids?: Array<{
        id: number;
        name: string;
        unit_amount: number;
        employee_id?: { id: number; name: string; work_email?: string };
        date: string;
        project_id?: [number, string];
        task_id?: [number, string];
        display_name?: string;
    }>;
    display_name: string;
    message_follower_ids?: MessageFollower[];
    timer_start?: string | false;
    timer_pause?: string | false;
    advance_amount?: number;
    advance_date?: string;
    write_date?: string;
    create_date?: string;
}

export interface Project {
    id: number;
    name: string;
    project_type: string;
    project_source?: 'client' | 'marche_public' | false;
    partner_id?: [number, string] | false;
    date_start?: string | false;
    type_ids?: any[];
    date?: string | false;
    tasks?: ProjectTask[];
    numero?: string | false;
    display_name: string;
    message_follower_ids?: MessageFollower[];
    write_date?: string;
    create_date?: string;
    privacy_visibility?: string;
}

export interface ProjectCategory {
    id: number;
    name: string;
    project_ids: Project[];
    write_date?: string;
    create_date?: string;
}

export interface ExpenseData {
    user_id: number;
    expense_type_id: number;
    expense_category_id: number;
    amount: number;
    description: string;
    date?: string;
    expense_date?: string;
}

export interface ExpenseResponse {
    success: boolean;
    message?: string;
    data?: any;
    result?: any;
}

export interface ProjectCategoryResponse {
    success: boolean;
    result?: ProjectCategory[];
    message?: string;
    operation_info?: {
        model: string;
        method: string;
        user: string;
    };
    timestamp?: string;
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

// ==================== SERVICE CATÉGORIES DE PROJETS (GLOBAL) ====================

export const projectCategoryService = {
    /**
     * 💾 SAUVEGARDE : Catégories dans SQLite
     */
    async saveCategoriesToCache(categories: ProjectCategory[]): Promise<void> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            // ✅ Sérialiser les données pour éviter NullPointerException
            const sanitizedCategories = categories.map(cat => ({
                ...cat,
                project_ids: cat.project_ids?.map(proj => ({
                    ...proj,
                    message_follower_ids: proj.message_follower_ids || [],
                    tasks: proj.tasks || [],
                    partner_id: proj.partner_id || false,
                    type_ids: proj.type_ids || [],
                })) || []
            }));

            // 🔒 Utiliser une transaction séquentielle simple (pas withTransactionAsync)
            await database.execAsync('DELETE FROM project_categories');

            const timestamp = Date.now();
            for (const category of sanitizedCategories) {
                await database.runAsync(
                    'INSERT INTO project_categories (id, data, updated_at) VALUES (?, ?, ?)',
                    [category.id, JSON.stringify(category), timestamp]
                );
            }
            
            console.log(`💾 ${categories.length} catégories sauvegardées dans SQLite`);
        } catch (error) {
            console.error('❌ Erreur sauvegarde catégories SQLite:', error);
            // 🛑 Ne pas throw - juste logger l'erreur
            console.warn('⚠️ Sauvegarde SQLite échouée - L\'app continuera avec les données en mémoire');
        }
    },

    /**
     * 📂 CHARGEMENT : Catégories depuis SQLite (avec filtrage par visibilité)
     */
    async loadCategoriesFromCache(): Promise<ProjectCategory[]> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            const rows = await database.getAllAsync<{ id: number; data: string; updated_at: number }>(
                'SELECT id, data, updated_at FROM project_categories ORDER BY id'
            );

            if (rows.length === 0) {
                console.log('📂 Aucune catégorie en cache SQLite');
                return [];
            }

            const categories = rows.map(row => JSON.parse(row.data) as ProjectCategory);
            const cacheDate = new Date(rows[0].updated_at);

            console.log(`📂 ${categories.length} catégories chargées depuis SQLite (cache: ${cacheDate.toLocaleString('fr-FR')})`);
            
            // 🔐 Appliquer le filtrage par visibilité
            const filteredCategories = await filterCategoriesByVisibility(categories);
            
            return filteredCategories;
        } catch (error) {
            console.error('❌ Erreur chargement catégories SQLite:', error);
            return [];
        }
    },

    /**
     * 🔄 APPLIQUER SYNC : Appliquer les changements de synchronisation à SQLite
     */
    async applySyncChanges(updatedCategories: ProjectCategory[], deleteIds: number[], currentCategories: ProjectCategory[]): Promise<void> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            // ✅ Sérialiser les données pour éviter NullPointerException
            const sanitizedCategories = updatedCategories.map(cat => ({
                ...cat,
                project_ids: cat.project_ids?.map(proj => ({
                    ...proj,
                    message_follower_ids: proj.message_follower_ids || [],
                    tasks: proj.tasks || [],
                    partner_id: proj.partner_id || false,
                    type_ids: proj.type_ids || [],
                })) || []
            }));

            // 🔒 Utiliser des opérations séquentielles simples
            // Supprimer les catégories à supprimer
            if (deleteIds.length > 0) {
                for (const id of deleteIds) {
                    await database.runAsync('DELETE FROM project_categories WHERE id = ?', [id]);
                }
                console.log(`🗑️ ${deleteIds.length} catégories supprimées de SQLite`);
            }

            // Insérer/Mettre à jour les catégories modifiées
            const timestamp = Date.now();
            for (const category of sanitizedCategories) {
                await database.runAsync(
                    'INSERT OR REPLACE INTO project_categories (id, data, updated_at) VALUES (?, ?, ?)',
                    [category.id, JSON.stringify(category), timestamp]
                );
            }
            
            console.log(`💾 ${sanitizedCategories.length} catégories insérées/mises à jour dans SQLite (UPSERT)`);
        } catch (error) {
            console.error('❌ Erreur application sync SQLite:', error);
            // 🛑 Ne pas throw - juste logger l'erreur
            console.warn('⚠️ Application sync SQLite échouée - L\'app continuera avec les données en mémoire');
        }
    },

    /**
     * 🔄 FORCE REFRESH : Synchronisation intelligente depuis l'API (pull-to-refresh)
     */
    async forceRefreshCategories(): Promise<ProjectCategoryResponse> {
        try {
            const cachedCategories = await this.loadCategoriesFromCache();

            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            const objects = cachedCategories.map(category => ({
                id: category.id,
                project_ids: category.project_ids?.map(project => ({
                    id: project.id,
                    tasks: project.tasks?.map(task => ({
                        id: task.id,
                        write_date: task.write_date || new Date().toISOString(),
                        create_date: task.create_date || new Date().toISOString()
                    })),
                    write_date: project.write_date || new Date().toISOString(),
                    create_date: project.create_date || new Date().toISOString()
                })),
                write_date: category.write_date || new Date().toISOString(),
                create_date: category.create_date || new Date().toISOString()
            }));

            const syncPayload = {
                "operation": "update",
                "db": credentials.db,
                "username": credentials.username,
                "password": credentials.password,
                "body": {
                    "project.category": {
                        "objects": objects,
                        "fields": ["name", "project_ids", "write_date", "create_date"],
                        "replaceToObject": [{
                            "project_ids": {
                                "project.project": [
                                    "name",
                                    "project_type",
                                    "project_source",
                                    "type_ids",
                                    "partner_id",
                                    "date_start",
                                    "date",
                                    "tasks",
                                    "numero",
                                    "write_date",
                                    "create_date",
                                    "message_follower_ids",
                                    "privacy_visibility"
                                ]
                            },
                            "project_ids.partner_id": {
                                "res.partner": ["name", "street"]
                            },
                            "project_ids.type_ids": {
                                "project.type": ["name"]
                            },
                            "project_ids.tasks": {
                                "project.task": [
                                    "name",
                                    "state",
                                    "partner_id",
                                    "user_ids",
                                    "expense_ids",
                                    "timer_start",
                                    "timer_pause",
                                    "timesheet_ids"
                                ]
                            },
                            "project_ids.tasks.partner_id": {
                                "res.partner": ["name", "street"]
                            },
                            "project_ids.tasks.user_ids": {
                                "res.users": ["name"]
                            },
                            "project_ids.tasks.expense_ids": {
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
                            },
                            "project_ids.tasks.expense_ids.expense_category_id": {
                                "expense.category": ["name", "display_name"]
                            },
                            "project_ids.tasks.expense_ids.expense_type_id": {
                                "expense.type": ["name", "display_name"]
                            },
                            "project_ids.tasks.timesheet_ids": {
                                "account.analytic.line": [
                                    "name",
                                    "unit_amount",
                                    "employee_id",
                                    "date",
                                    "project_id",
                                    "task_id",
                                    "display_name"
                                ]
                            },
                            "project_ids.message_follower_ids": {
                                "mail.followers": ["partner_id"]
                            },
                            "project_ids.message_follower_ids.partner_id": {
                                "res.partner": ["name"]
                            }
                        }]
                    }
                }
            };

            console.log("🔄 SYNC CATEGORIES PAYLOAD", JSON.stringify(syncPayload, null, 2));

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
            console.log('📥 Réponse sync catégories reçue:', {
                success: data.success,
                updated: data.summary?.total_updated,
                deleted: data.summary?.total_deleted,
                total: data.summary?.total_objects
            });

            if (data.success && data.result && data.result['project.category']) {
                let updatedCategories = data.result['project.category'];
                const deleteIds = data.delete_ids?.['project.category'] || [];

                console.log(`📥 Sync brut: ${updatedCategories.length} catégories, ${deleteIds.length} à supprimer`);

                // 🔐 IMPORTANT: Appliquer le filtrage par visibilité AVANT de sauvegarder
                console.log('🔐 Application du filtrage privacy_visibility sur les catégories sync...');
                updatedCategories = await filterCategoriesByVisibility(updatedCategories);
                console.log(`✅ Filtrage appliqué - ${updatedCategories.reduce((sum, cat) => sum + (cat.project_ids?.length || 0), 0)} projets visibles`);

                await this.applySyncChanges(updatedCategories, deleteIds, cachedCategories);

                // 🔔 Charger et émettre les catégories après sync pull-to-refresh (user-initiated)
                const finalCategories = await this.loadCategoriesFromCache();
                
                // ✅ ÉMETTRE l'événement car c'est un pull-to-refresh (action utilisateur)
                console.log('✅ Émission événement après pull-to-refresh');
                categoryEventEmitter.emit('categoriesUpdated', finalCategories);

                return {
                    success: true,
                    result: finalCategories,
                    message: `Synchronisation réussie: ${updatedCategories.length} mis à jour, ${deleteIds.length} supprimés`,
                    timestamp: data.timestamp
                };
            } else {
                throw new Error(`Format de réponse inattendu: ${JSON.stringify(data)}`);
            }
        } catch (error) {
            console.error('❌ Erreur force refresh catégories:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Erreur inconnue'
            };
        }
    },

    /**
     * ✅ RÉCUPÉRATION : Toutes les catégories avec leurs projets (offline-first)
     */
    async getProjectCategories(): Promise<ProjectCategoryResponse> {
        try {
            console.log('📊 Récupération des catégories de projets (offline-first)...');

            const cachedCategories = await this.loadCategoriesFromCache();

            if (cachedCategories.length > 0) {
                console.log(`📂 ${cachedCategories.length} catégories trouvées dans cache SQLite`);

                this.refreshCategoriesInBackground();

                return {
                    success: true,
                    result: cachedCategories,
                    message: 'Données chargées depuis le cache local'
                };
            }

            console.log('📂 Cache SQLite vide, chargement depuis API...');
            const categories = await this.fetchCategoriesFromAPI();

            if (categories.length > 0) {
                console.log(`✅ ${categories.length} catégories filtrées récupérées depuis API`);

                await this.saveCategoriesToCache(categories);
                console.log('💾 Catégories filtrées sauvegardées dans le cache SQLite');

                // ⚠️ PAS besoin de filtrer à nouveau car fetchCategoriesFromAPI() applique déjà le filtrage
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
        // 🔒 Si un refresh est déjà en cours, attendre qu'il finisse
        if (refreshQueue) {
            console.log('⏳ Refresh en cours, attente...');
            await refreshQueue;
            console.log('✅ Refresh précédent terminé');
            return;
        }

        // 🔒 Créer une nouvelle promesse de refresh
        refreshQueue = (async () => {
            try {
                if (isBackgroundRefreshing) {
                    console.log('⚠️ Background refresh déjà en cours, skip...');
                    return;
                }

                isBackgroundRefreshing = true;
                console.log('🔄 Rafraîchissement catégories en arrière-plan depuis API...');

                const categories = await this.fetchCategoriesFromAPI();

                if (categories.length > 0) {
                    console.log(`🔄 ${categories.length} catégories rafraîchies depuis API`);
                    await this.saveCategoriesToCache(categories);
                    console.log('✅ Cache SQLite catégories mis à jour en arrière-plan');

                    // ⏱️ Vérifier si les données ont vraiment changé
                    const currentTimestamp = Date.now();
                    if (currentTimestamp - lastUpdateTimestamp < 500) {
                        console.log('⚠️ Update trop récent, skip event emission');
                        return;
                    }
                    lastUpdateTimestamp = currentTimestamp;

                    // ❌ NE PAS émettre d'événement lors du refresh en arrière-plan
                    // L'UI a déjà les données du cache, pas besoin de re-render
                    console.log('ℹ️ Background refresh terminé - Pas d\'événement émis (évite loop)');
                }
            } catch (error) {
                console.warn('⚠️ Échec rafraîchissement catégories en arrière-plan (pas grave):', error);
            } finally {
                isBackgroundRefreshing = false;
                refreshQueue = null;
            }
        })();

        await refreshQueue;
    },

    /**
     * 🌐 FETCH API : Récupérer les catégories depuis l'API Odoo (avec filtrage privacy_visibility)
     */
    async fetchCategoriesFromAPI(): Promise<ProjectCategory[]> {
        const credentials = await getStoredCredentials();
        if (!credentials) {
            throw new Error('Aucune authentification trouvée');
        }

        const payload = {
            "operation": "rpc",
            "db": credentials.db,
            "username": credentials.username,
            "password": credentials.password,
            "model": "project.category",
            "method": "search_read",
            "kwargs": {
                "domain": [],
                "fields": ["name", "project_ids"],
                "replaceToObject": [{
                    "project_ids": {
                        "project.project": [
                            "name",
                            "project_type",
                            "project_source",
                            "type_ids",
                            "partner_id",
                            "date_start",
                            "date",
                            "tasks",
                            "numero",
                            "write_date",
                            "create_date",
                            "message_follower_ids",
                            "privacy_visibility"
                        ]
                    },
                    "project_ids.partner_id": {
                        "res.partner": ["name", "street"]
                    },
                    "project_ids.type_ids": {
                        "project.type": ["name"]
                    },
                    "project_ids.tasks": {
                        "project.task": [
                            "name",
                            "state",
                            "partner_id",
                            "user_ids",
                            "expense_ids",
                            "timer_start",
                            "timer_pause",
                            "timesheet_ids"
                        ]
                    },
                    "project_ids.tasks.partner_id": {
                        "res.partner": ["name", "street"]
                    },
                    "project_ids.tasks.user_ids": {
                        "res.users": ["name"]
                    },
                    "project_ids.tasks.expense_ids": {
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
                    },
                    "project_ids.tasks.expense_ids.expense_category_id": {
                        "expense.category": ["name", "display_name"]
                    },
                    "project_ids.tasks.expense_ids.expense_type_id": {
                        "expense.type": ["name", "display_name"]
                    },
                    "project_ids.tasks.timesheet_ids": {
                        "account.analytic.line": [
                            "name",
                            "unit_amount",
                            "employee_id",
                            "date",
                            "project_id",
                            "task_id",
                            "display_name"
                        ]
                    },
                    "project_ids.message_follower_ids": {
                        "mail.followers": ["partner_id"]
                    },
                    "project_ids.message_follower_ids.partner_id": {
                        "res.partner": ["name"]
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

        let categories: ProjectCategory[] = [];
        if (data.success && Array.isArray(data.result)) {
            categories = data.result;
        } else if (Array.isArray(data)) {
            categories = data;
        } else {
            throw new Error(`Format de réponse inattendu: ${JSON.stringify(data)}`);
        }

        // 🔐 IMPORTANT: Appliquer le filtrage par visibilité AVANT de retourner
        console.log(`📥 ${categories.length} catégories récupérées depuis API - Application du filtrage privacy_visibility...`);
        const filteredCategories = await filterCategoriesByVisibility(categories);
        console.log(`✅ Filtrage appliqué - ${filteredCategories.reduce((sum, cat) => sum + (cat.project_ids?.length || 0), 0)} projets visibles`);
        
        return filteredCategories;
    },

    /**
     * 💾 INSERT OR UPDATE : Insérer ou mettre à jour une catégorie spécifique dans SQLite
     * ⚠️ Merge intelligent: garde les données complètes des projets existants
     */
    async insertOrUpdateCategory(categoryUpdate: any): Promise<boolean> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            console.log(`🔄 Mise à jour catégorie ${categoryUpdate.id} via WebSocket:`, {
                name: categoryUpdate.name,
                project_ids_received: Array.isArray(categoryUpdate.project_ids) 
                    ? categoryUpdate.project_ids 
                    : categoryUpdate.project_ids?.length || 0
            });

            // 📚 Charger la catégorie existante depuis SQLite
            const existingRow = await database.getFirstAsync<{ id: number; data: string; updated_at: number }>(
                'SELECT id, data, updated_at FROM project_categories WHERE id = ?',
                [categoryUpdate.id]
            );

            let mergedCategory: ProjectCategory;

            if (existingRow) {
                // ✅ MERGE: Catégorie existe déjà - Faire un merge intelligent
                const existingCategory = JSON.parse(existingRow.data) as ProjectCategory;
                
                console.log(`🔀 Merge catégorie existante ${categoryUpdate.id}`);

                // Si categoryUpdate.project_ids est un array de nombres (IDs seulement)
                if (Array.isArray(categoryUpdate.project_ids) && 
                    categoryUpdate.project_ids.length > 0 && 
                    typeof categoryUpdate.project_ids[0] === 'number') {
                    
                    // ✅ Filtrer les projets existants pour garder seulement ceux dans la nouvelle liste d'IDs
                    const newProjectIds = categoryUpdate.project_ids as number[];
                    const existingProjects = existingCategory.project_ids || [];
                    
                    // Garder les projets existants qui sont toujours dans la catégorie
                    const keptProjects = existingProjects.filter(p => newProjectIds.includes(p.id));
                    
                    console.log(`📋 Projets filtrés: ${keptProjects.length}/${existingProjects.length} gardés`);
                    
                    mergedCategory = {
                        ...existingCategory,
                        name: categoryUpdate.name || existingCategory.name,
                        display_name: categoryUpdate.display_name || categoryUpdate.name || existingCategory.display_name,
                        project_ids: keptProjects,
                        write_date: new Date().toISOString()
                    };
                } else {
                    // Si categoryUpdate.project_ids contient des objets complets
                    mergedCategory = {
                        ...existingCategory,
                        name: categoryUpdate.name || existingCategory.name,
                        display_name: categoryUpdate.display_name || categoryUpdate.name || existingCategory.display_name,
                        project_ids: categoryUpdate.project_ids || existingCategory.project_ids,
                        write_date: new Date().toISOString()
                    };
                }
            } else {
                // ➕ NOUVELLE CATÉGORIE: Pas de merge nécessaire
                console.log(`➕ Nouvelle catégorie ${categoryUpdate.id}`);
                
                mergedCategory = {
                    id: categoryUpdate.id,
                    name: categoryUpdate.name,
                    display_name: categoryUpdate.display_name || categoryUpdate.name,
                    project_ids: [],  // Vide car on n'a que les IDs, pas les données complètes
                    create_date: new Date().toISOString(),
                    write_date: new Date().toISOString()
                };
            }

            // 💾 Sauvegarder dans SQLite
            const timestamp = Date.now();
            await database.runAsync(
                'INSERT OR REPLACE INTO project_categories (id, data, updated_at) VALUES (?, ?, ?)',
                [mergedCategory.id, JSON.stringify(mergedCategory), timestamp]
            );

            console.log(`✅ Catégorie ${mergedCategory.id} (${mergedCategory.name}) mergeée et sauvegardée`);

            // 🔔 Émettre l'événement pour mettre à jour l'UI immédiatement
            categoryEventEmitter.emit('categoryUpdated', mergedCategory);
            
            // 🔄 Charger toutes les catégories et émettre l'événement global
            const allCategories = await this.loadCategoriesFromCache();
            categoryEventEmitter.emit('categoriesUpdated', allCategories);

            return true;

        } catch (error) {
            console.error('❌ Erreur sync catégorie WebSocket:', error);
            return false;
        }
    },

    /**
     * 🗑️ DELETE CATEGORY : Supprimer une catégorie spécifique de SQLite
     */
    async deleteCategory(categoryId: number): Promise<boolean> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            const existingCategory = await database.getFirstAsync<{ id: number }>(
                'SELECT id FROM project_categories WHERE id = ?',
                [categoryId]
            );

            if (!existingCategory) {
                console.log(`⚠️ Catégorie ${categoryId} déjà supprimée ou n'existe pas`);
                return false;
            }

            await database.runAsync('DELETE FROM project_categories WHERE id = ?', [categoryId]);

            console.log(`✅ Catégorie ${categoryId} supprimée de SQLite`);

            // 🔔 Émettre les événements pour mettre à jour l'UI
            categoryEventEmitter.emit('categoryDeleted', categoryId);
            
            // 🔄 Charger toutes les catégories et émettre l'événement global
            const allCategories = await this.loadCategoriesFromCache();
            categoryEventEmitter.emit('categoriesUpdated', allCategories);

            return true;

        } catch (error) {
            console.error(`❌ Erreur lors de la suppression de la catégorie ${categoryId}:`, error);
            return false;
        }
    },

    /**
     * 🗑️ CLEAR CATEGORIES : Supprimer toutes les catégories de la base SQLite
     */
    async clearCategories(): Promise<boolean> {
        try {
            const database = await initDatabase();
            if (!database) throw new Error('Database not initialized');

            await database.runAsync('DELETE FROM project_categories');

            console.log('✅ Toutes les catégories ont été supprimées de SQLite');

            categoryEventEmitter.emit('categoriesCleared');
            categoryEventEmitter.emit('projectsCleared');

            return true;

        } catch (error) {
            console.error('❌ Erreur lors de la suppression des catégories:', error);
            return false;
        }
    },

    /**
     * ⏰ TIMER FUNCTIONS - Gestion des timers de tâches
     */
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

    /**
     * 💰 EXPENSE FUNCTIONS - Gestion des dépenses
     */
    async createExpense(taskId: number, expenseData: ExpenseData): Promise<ExpenseResponse> {
        try {
            console.log(`💰 Création d'une dépense pour la tâche ${taskId}...`, expenseData);

            const credentials = await getStoredCredentials();
            if (!credentials) {
                throw new Error('Aucune authentification trouvée');
            }

            const response = await fetch(getCurrentApiUrl(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(EXPENSE_PAYLOADS.createExpense(credentials, taskId, expenseData))
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data && (data.success === true || data.result || data.id)) {
                console.log(`✅ Dépense créée avec succès pour la tâche ${taskId}`);
                return {
                    success: true,
                    message: 'Dépense créée avec succès',
                    data: data.result || data,
                    result: data.result
                };
            } else {
                return {
                    success: false,
                    message: data?.message || 'Erreur lors de la création de la dépense'
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

    /**
     * ✅ GET PROJECTS - Récupérer tous les projets de toutes les catégories
     */
    async getProjects(): Promise<ProjectsResponse> {
        try {
            const response = await this.getProjectCategories();
            if (response.success && response.result) {
                // Extraire tous les projets de toutes les catégories
                const allProjects: Project[] = [];
                response.result.forEach(category => {
                    if (category.project_ids && Array.isArray(category.project_ids)) {
                        allProjects.push(...category.project_ids);
                    }
                });
                return {
                    success: true,
                    result: allProjects,
                    message: response.message
                };
            }
            return {
                success: false,
                message: response.message,
                result: []
            };
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
     * 🗑️ CLEAR PROJECTS - Alias pour clearCategories
     */
    async clearProjects(): Promise<boolean> {
        return this.clearCategories();
    },

    /**
     * 💾 INSERT OR UPDATE PROJECT : Insérer ou mettre à jour UN projet dans SA catégorie dans SQLite (avec filtrage privacy_visibility)
     * Cette méthode est utilisée par WebSocket pour mettre à jour un projet spécifique
     * 
     * Logique:
     * 1. Si le projet n'existe pas → L'ajouter dans sa catégorie (category_id)
     * 2. Si le projet existe déjà dans la BONNE catégorie → Le remplacer (update)
     * 3. Si le projet existe dans une AUTRE catégorie → Le supprimer de l'ancienne et l'ajouter dans la nouvelle
     */
    async insertOrUpdateProject(projectData: any): Promise<boolean> {
        try {
            // ✅ Vérification préliminaire des données
            if (!projectData || typeof projectData !== 'object') {
                console.error('❌ insertOrUpdateProject: projectData invalide ou manquant');
                return false;
            }

            const database = await initDatabase();
            if (!database) {
                console.error('❌ insertOrUpdateProject: Database not initialized');
                return false;
            }

            // Extraire les informations du projet
            const projectId = projectData.id;
            const newCategoryId = projectData.category_id || projectData.project_category_id;

            if (!projectId) {
                console.error('❌ Project ID manquant dans les données WebSocket');
                return false;
            }

            // ✅ Si pas de category_id (False ou null), on supprime le projet du cache s'il existe
            if (!newCategoryId || newCategoryId === false) {
                console.warn(`⚠️ Projet ${projectId} sans category_id - Suppression du cache si existant`);
                
                // Charger toutes les catégories depuis SQLite
                const rows = await database.getAllAsync<{ id: number; data: string; updated_at: number }>(
                    'SELECT id, data, updated_at FROM project_categories ORDER BY id'
                );

                if (rows.length === 0) {
                    console.log('✅ Aucune catégorie en cache, rien à supprimer');
                    return true;
                }

                let categories = rows.map(row => JSON.parse(row.data) as ProjectCategory);
                let projectFound = false;

                // Parcourir toutes les catégories et supprimer le projet
                for (let i = 0; i < categories.length; i++) {
                    if (categories[i].project_ids && Array.isArray(categories[i].project_ids)) {
                        const projectIndex = categories[i].project_ids.findIndex(p => p.id === projectId);

                        if (projectIndex >= 0) {
                            console.log(`🗑️ Projet ${projectId} trouvé dans catégorie ${categories[i].id} - Suppression`);
                            categories[i].project_ids.splice(projectIndex, 1);
                            projectFound = true;

                            // Sauvegarder la catégorie mise à jour
                            const timestamp = Date.now();
                            await database.runAsync(
                                'INSERT OR REPLACE INTO project_categories (id, data, updated_at) VALUES (?, ?, ?)',
                                [categories[i].id, JSON.stringify(categories[i]), timestamp]
                            );

                            console.log(`✅ Projet ${projectId} supprimé de la catégorie ${categories[i].id}`);
                            
                            // 🔔 Émettre l'événement projectDeleted
                            categoryEventEmitter.emit('projectDeleted', projectId);
                            break;
                        }
                    }
                }

                if (!projectFound) {
                    console.log(`ℹ️ Projet ${projectId} non trouvé dans le cache, rien à supprimer`);
                }

                return true;
            }

            console.log(`🔄 WebSocket: Projet ${projectId} doit être dans la catégorie ${newCategoryId}`);

            // 🔐 Vérifier si l'utilisateur peut voir ce projet AVANT de l'ajouter/mettre à jour
            const currentUser = await authService.getCurrentUser();
            const userPartnerId = currentUser?.partner_id;
            
            const canView = canUserViewProject(projectData as Project, userPartnerId);
            if (!canView) {
                console.log(`🔒 Projet ${projectId} (privacy=${projectData.privacy_visibility}) - Accès refusé pour l'utilisateur (partner_id=${userPartnerId}) - Ne sera PAS mis à jour dans SQLite`);
                // ⚠️ Si le projet existe déjà en cache, le supprimer car l'utilisateur n'a plus accès
                await this.deleteProject(projectId);
                return true; // Retourner true car l'opération de filtrage a réussi
            }

            console.log(`✅ Projet ${projectId} - Accès autorisé - Procéder à la mise à jour`);

            // Charger toutes les catégories depuis SQLite
            let rows;
            try {
                rows = await database.getAllAsync<{ id: number; data: string; updated_at: number }>(
                    'SELECT id, data, updated_at FROM project_categories ORDER BY id'
                );
            } catch (sqlError) {
                console.error('❌ Erreur SQL getAllAsync:', sqlError);
                console.error('🔍 Détails:', {
                    projectId,
                    newCategoryId,
                    error: sqlError instanceof Error ? sqlError.message : 'Unknown error',
                    stack: sqlError instanceof Error ? sqlError.stack : 'No stack'
                });
                return false;
            }

            if (rows.length === 0) {
                console.warn('⚠️ Aucune catégorie trouvée dans SQLite pour mise à jour projet');
                return false;
            }

            let categories = rows.map(row => JSON.parse(row.data) as ProjectCategory);
            
            // 🔍 ÉTAPE 1: Chercher si le projet existe déjà dans TOUTES les catégories
            let oldCategoryId: number | null = null;
            let projectFoundIndex: number = -1;

            for (const category of categories) {
                if (category.project_ids && Array.isArray(category.project_ids)) {
                    const projectIndex = category.project_ids.findIndex(p => p.id === projectId);
                    if (projectIndex >= 0) {
                        oldCategoryId = category.id;
                        projectFoundIndex = projectIndex;
                        console.log(`📍 Projet ${projectId} trouvé dans la catégorie ${oldCategoryId}`);
                        break;
                    }
                }
            }

            // 🔄 ÉTAPE 2: Vérifier si la catégorie de destination existe
            const targetCategoryIndex = categories.findIndex(c => c.id === newCategoryId);
            if (targetCategoryIndex === -1) {
                console.warn(`⚠️ Catégorie de destination ${newCategoryId} n'existe pas dans SQLite`);
                return false;
            }

            // Initialiser project_ids si nécessaire
            if (!categories[targetCategoryIndex].project_ids) {
                categories[targetCategoryIndex].project_ids = [];
            }

            // 🎯 ÉTAPE 3: Gérer les différents cas
            const timestamp = Date.now();

            if (oldCategoryId === null) {
                // CAS 1: Projet n'existe pas → L'ajouter dans sa catégorie
                console.log(`➕ Ajout du nouveau projet ${projectId} dans la catégorie ${newCategoryId}`);
                
                categories[targetCategoryIndex].project_ids.push({
                    ...projectData,
                    message_follower_ids: projectData.message_follower_ids || [],
                    tasks: projectData.tasks || [],
                    partner_id: projectData.partner_id || false,
                    type_ids: projectData.type_ids || [],
                } as Project);

                    // Sauvegarder la catégorie
                    try {
                        await database.runAsync(
                            'INSERT OR REPLACE INTO project_categories (id, data, updated_at) VALUES (?, ?, ?)',
                            [categories[targetCategoryIndex].id, JSON.stringify(categories[targetCategoryIndex]), timestamp]
                        );
                    } catch (sqlError) {
                        console.error('❌ Erreur SQL runAsync (ajout):', sqlError);
                        return false;
                    }

                console.log(`✅ Projet ${projectId} ajouté dans la catégorie ${newCategoryId}`);

            } else if (oldCategoryId === newCategoryId) {
                // CAS 2: Projet existe dans la BONNE catégorie → Le remplacer (update)
                console.log(`♻️ Remplacement du projet ${projectId} dans la même catégorie ${newCategoryId}`);
                
                const projectIndex = categories[targetCategoryIndex].project_ids.findIndex(p => p.id === projectId);
                if (projectIndex >= 0) {
                    // Remplacer complètement l'ancien projet par le nouveau
                    categories[targetCategoryIndex].project_ids[projectIndex] = {
                        ...projectData,
                        message_follower_ids: projectData.message_follower_ids || [],
                        tasks: projectData.tasks || [],
                        partner_id: projectData.partner_id || false,
                        type_ids: projectData.type_ids || [],
                    } as Project;

                    // Sauvegarder la catégorie
                    try {
                        await database.runAsync(
                            'INSERT OR REPLACE INTO project_categories (id, data, updated_at) VALUES (?, ?, ?)',
                            [categories[targetCategoryIndex].id, JSON.stringify(categories[targetCategoryIndex]), timestamp]
                        );
                    } catch (sqlError) {
                        console.error('❌ Erreur SQL runAsync (update):', sqlError);
                        return false;
                    }

                    console.log(`✅ Projet ${projectId} remplacé dans la catégorie ${newCategoryId}`);
                }

            } else {
                // CAS 3: Projet existe dans une AUTRE catégorie → Le déplacer
                console.log(`🔄 Déplacement du projet ${projectId} de la catégorie ${oldCategoryId} vers ${newCategoryId}`);
                
                // 🗑️ SUPPRIMER de l'ancienne catégorie
                const oldCategoryIndex = categories.findIndex(c => c.id === oldCategoryId);
                if (oldCategoryIndex >= 0 && categories[oldCategoryIndex].project_ids) {
                    categories[oldCategoryIndex].project_ids = categories[oldCategoryIndex].project_ids.filter(
                        p => p.id !== projectId
                    );

                    // Sauvegarder l'ancienne catégorie
                    try {
                        await database.runAsync(
                            'INSERT OR REPLACE INTO project_categories (id, data, updated_at) VALUES (?, ?, ?)',
                            [categories[oldCategoryIndex].id, JSON.stringify(categories[oldCategoryIndex]), timestamp]
                        );
                    } catch (sqlError) {
                        console.error('❌ Erreur SQL runAsync (delete old):', sqlError);
                        // Continue quand même pour essayer d'ajouter dans la nouvelle catégorie
                    }

                    console.log(`🗑️ Projet ${projectId} supprimé de l'ancienne catégorie ${oldCategoryId}`);
                }

                // ➕ AJOUTER dans la nouvelle catégorie
                categories[targetCategoryIndex].project_ids.push({
                    ...projectData,
                    message_follower_ids: projectData.message_follower_ids || [],
                    tasks: projectData.tasks || [],
                    partner_id: projectData.partner_id || false,
                    type_ids: projectData.type_ids || [],
                } as Project);

                // Sauvegarder la nouvelle catégorie
                try {
                    await database.runAsync(
                        'INSERT OR REPLACE INTO project_categories (id, data, updated_at) VALUES (?, ?, ?)',
                        [categories[targetCategoryIndex].id, JSON.stringify(categories[targetCategoryIndex]), timestamp]
                    );
                } catch (sqlError) {
                    console.error('❌ Erreur SQL runAsync (add new):', sqlError);
                    return false;
                }

                console.log(`✅ Projet ${projectId} ajouté dans la nouvelle catégorie ${newCategoryId}`);
            }

            // 🔔 Émettre SEULEMENT l'événement projectUpdated pour un update ciblé
            // ⚠️ NE PAS émettre categoriesUpdated pour éviter le scroll/reload
            categoryEventEmitter.emit('projectUpdated', projectData);
            
            console.log(`✅ Événement projectUpdated émis pour le projet ${projectId}`);

            return true;

        } catch (error) {
            console.error('❌ Erreur insertOrUpdateProject:', error);
            console.error('🔍 Détails erreur:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : 'No stack',
                projectData: projectData ? {
                    id: projectData.id,
                    category_id: projectData.category_id,
                    name: projectData.name,
                    hasData: true
                } : 'projectData is null/undefined'
            });
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

            console.log(`🗑️ Suppression du projet ${projectId} de SQLite...`);

            // Charger toutes les catégories
            const rows = await database.getAllAsync<{ id: number; data: string; updated_at: number }>(
                'SELECT id, data, updated_at FROM project_categories ORDER BY id'
            );

            if (rows.length === 0) {
                console.warn('⚠️ Aucune catégorie trouvée dans SQLite');
                return false;
            }

            let categories = rows.map(row => JSON.parse(row.data) as ProjectCategory);
            let projectDeleted = false;

            // Parcourir toutes les catégories et supprimer le projet
            for (let i = 0; i < categories.length; i++) {
                if (categories[i].project_ids && Array.isArray(categories[i].project_ids)) {
                    const projectIndex = categories[i].project_ids.findIndex(p => p.id === projectId);

                    if (projectIndex >= 0) {
                        console.log(`🗑️ Projet ${projectId} trouvé dans catégorie ${categories[i].id}`);
                        categories[i].project_ids.splice(projectIndex, 1);
                        projectDeleted = true;

                        // Sauvegarder la catégorie mise à jour
                        const timestamp = Date.now();
                        await database.runAsync(
                            'INSERT OR REPLACE INTO project_categories (id, data, updated_at) VALUES (?, ?, ?)',
                            [categories[i].id, JSON.stringify(categories[i]), timestamp]
                        );

                        console.log(`✅ Projet ${projectId} supprimé de SQLite (catégorie ${categories[i].id})`);
                        break;
                    }
                }
            }

            if (projectDeleted) {
                // 🔔 Émettre SEULEMENT l'événement projectDeleted pour un update ciblé
                // ⚠️ NE PAS émettre categoriesUpdated pour éviter le scroll/reload
                categoryEventEmitter.emit('projectDeleted', projectId);
                
                console.log(`✅ Événement projectDeleted émis pour le projet ${projectId}`);

                return true;
            } else {
                console.warn(`⚠️ Projet ${projectId} non trouvé dans aucune catégorie`);
                return false;
            }

        } catch (error) {
            console.error(`❌ Erreur deleteProject ${projectId}:`, error);
            return false;
        }
    }
};

// ==================== EVENT SUBSCRIPTIONS ====================

// Fonction pour s'abonner aux mises à jour de catégories
export const subscribeToCategoryUpdates = (callback: (categories: ProjectCategory[]) => void) => {
    categoryEventEmitter.on('categoriesUpdated', callback);
    return () => categoryEventEmitter.off('categoriesUpdated', callback);
};

// Fonction pour s'abonner à la suppression d'une catégorie
export const subscribeToCategoryDeleted = (callback: (categoryId: number) => void) => {
    categoryEventEmitter.on('categoryDeleted', callback);
    return () => categoryEventEmitter.off('categoryDeleted', callback);
};

// Fonction pour s'abonner au vidage du cache
export const subscribeToCategoriesCleared = (callback: () => void) => {
    categoryEventEmitter.on('categoriesCleared', callback);
    return () => categoryEventEmitter.off('categoriesCleared', callback);
};

// ✅ ALIAS POUR COMPATIBILITÉ AVEC projectService

/**
 * S'abonner aux mises à jour de projets (via les catégories)
 */
export const subscribeToProjectUpdates = (callback: (project: Project) => void) => {
    const handler = (categories: ProjectCategory[]) => {
        categories.forEach(category => {
            if (category.project_ids && Array.isArray(category.project_ids)) {
                category.project_ids.forEach(project => {
                    callback(project);
                });
            }
        });
    };
    categoryEventEmitter.on('categoriesUpdated', handler);
    
    // Also listen for individual project updates
    categoryEventEmitter.on('projectUpdated', callback);
    
    return () => {
        categoryEventEmitter.off('categoriesUpdated', handler);
        categoryEventEmitter.off('projectUpdated', callback);
    };
};

/**
 * S'abonner à la suppression d'une tâche
 */
export const subscribeToTaskDeleted = (callback: (data: { projectId: number; taskId: number }) => void) => {
    categoryEventEmitter.on('taskDeleted', callback);
    return () => categoryEventEmitter.off('taskDeleted', callback);
};

/**
 * S'abonner à la suppression d'un projet
 */
export const subscribeToProjectDeleted = (callback: (projectId: number) => void) => {
    categoryEventEmitter.on('projectDeleted', callback);
    return () => categoryEventEmitter.off('projectDeleted', callback);
};

/**
 * S'abonner au vidage du cache des projets
 */
export const subscribeToProjectsCleared = (callback: () => void) => {
    categoryEventEmitter.on('projectsCleared', callback);
    return () => categoryEventEmitter.off('projectsCleared', callback);
};

// Export du service par défaut + alias pour compatibilité
export default projectCategoryService;