import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import Breadcrumb from '@/components/navigation/Breadcrumb';
import projectCategoryService, { 
  subscribeToCategoryUpdates,
  subscribeToProjectUpdates,
  subscribeToCategoriesCleared,
} from '@/services/projectCategoryService';

// ✅ Helper function pour extraire les infos utilisateur
const getUserInfo = (user_id: any): { name: string; id: number } | null => {
  if (!user_id || user_id === false) return null;

  // Case: Array with a single object, e.g., [{ id: 13, name: "name user" }]
  if (Array.isArray(user_id) && user_id.length === 1 && typeof user_id[0] === 'object' && user_id[0] !== null && 'name' in user_id[0] && 'id' in user_id[0]) {
    return { id: user_id[0].id, name: user_id[0].name };
  }

  // Case: Array with [id, name], e.g., [13, "name user"]
  if (Array.isArray(user_id) && user_id.length > 1) {
    return { id: user_id[0], name: user_id[1] };
  }

  // Case: Simple object, e.g., { id: 13, name: "name user" }
  if (typeof user_id === 'object' && !Array.isArray(user_id) && user_id !== null && 'name' in user_id && 'id' in user_id) {
    return { id: user_id.id, name: user_id.name };
  }

  return null;
};


// ✅ Helper function pour calculer les totaux financiers d'une tâche
const calculateTaskFinancials = (task: any) => {
  let totalExpenses = 0;
  let totalSettlements = 0;

  if (task.expense_ids && Array.isArray(task.expense_ids)) {
    task.expense_ids.forEach((expense: any) => {
      const amount = Math.abs(expense.solde_amount ?? expense.amount ?? expense.balance ?? 0);
      
      // Vérifier le type de mouvement
      if (expense.expense_move_type === 'replenish') {
        totalSettlements += amount;
      } else if (expense.expense_move_type === 'spent') {
        totalExpenses += amount;
      }
    });
  }

  return {
    totalExpenses,
    totalSettlements,
    balance: totalSettlements - totalExpenses
  };
};

export default function ProjectDetailsScreen() {
  const params = useLocalSearchParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | '1_done' | '01_in_progress' | '1_canceled'>('all');
  const [refreshKey, setRefreshKey] = useState(0); // 🆕 Clé pour forcer le re-render

  // Load project from API
  const loadProjectDetails = async (projectId: number) => {
    try {
      console.log('📋 Chargement des détails du projet:', projectId);
      const response = await projectCategoryService.getProjectCategories();
      
      if (response.success && response.result) {
        // Chercher le projet dans toutes les catégories
        let updatedProject = null;
        for (const category of response.result) {
          if (category.project_ids && Array.isArray(category.project_ids)) {
            updatedProject = category.project_ids.find(p => p.id === projectId);
            if (updatedProject) break;
          }
        }
        
        if (updatedProject) {
          setProject(updatedProject);
          console.log('✅ Projet mis à jour:', updatedProject.name);
        } else {
          console.warn('⚠️ Projet non trouvé dans la réponse');
        }
      }
    } catch (error) {
      console.error('❌ Erreur chargement projet:', error);
    }
  };

  useEffect(() => {
    if (params.project) {
      try {
        const projectData = JSON.parse(params.project as string);
        setProject(projectData);
        setLoading(false);
        // Auto-refresh on mount
        if (projectData.id) {
          loadProjectDetails(projectData.id);
        }
      } catch (error) {
        console.error('Erreur parsing project data:', error);
        Alert.alert('Erreur', 'Impossible de charger les détails du projet');
        router.back();
      }
    }
  }, [params.project]);

  // 🔄 S'abonner aux mises à jour WebSocket des catégories (PULL-TO-REFRESH SEULEMENT)
  useEffect(() => {
  if (!project) return;
  
  console.log('🔔 Abonnement aux mises à jour des catégories (project-details - pull-to-refresh)...');
  
  const unsubscribe = subscribeToCategoryUpdates(async (updatedCategories) => {
  console.log('🔄 Catégories mises à jour via pull-to-refresh (project-details)');
  
  // 🆕 IMPORTANT: Recharger depuis le cache pour obtenir les données filtrées correctement
  const response = await projectCategoryService.getProjectCategories();
  if (response.success && response.result) {
    // Chercher notre projet dans les catégories mises à jour
    let updatedProject = null;
    for (const category of response.result) {
      if (category.project_ids && Array.isArray(category.project_ids)) {
        updatedProject = category.project_ids.find(p => p.id === project.id);
        if (updatedProject) break;
      }
    }
    
    if (updatedProject) {
      console.log('✅ Projet mis à jour via pull-to-refresh:', updatedProject.name);
      // 🆕 Mettre à jour le projet avec les nouvelles données
      setProject(updatedProject);
      // 🆕 Forcer le re-render SEULEMENT lors d'un pull-to-refresh
      setRefreshKey(prev => prev + 1);
    } else {
      // Si le projet n'est plus dans les catégories, peut-être supprimé ou filtré
      console.warn('⚠️ Projet non trouvé dans les catégories mises à jour');
    }
  }
  });
  
  return () => {
          console.log('🧹 Désabonnement des mises à jour des catégories (project-details)');
            unsubscribe();
        };
    }, [project?.id]);

  // 🔔 S'abonner aux mises à jour WebSocket de PROJET INDIVIDUEL (SANS SCROLL)
  useEffect(() => {
    if (!project) return;
    
    console.log('🔔 Abonnement aux mises à jour de projet individuel (project-details - WebSocket)...');
    
    const unsubscribe = subscribeToProjectUpdates((updatedProject) => {
      // ✅ Filtrer seulement les updates pour NOTRE projet
      if (updatedProject.id === project.id) {
        console.log('✅ Projet mis à jour via WebSocket (SANS SCROLL):', updatedProject.name);
        // ⚠️ IMPORTANT: Mettre à jour SANS incrémenter refreshKey pour éviter le scroll
        setProject(updatedProject);
        // ❌ NE PAS faire setRefreshKey() ici - c'est ça qui cause le scroll!
      }
    });
    
    return () => {
      console.log('🧹 Désabonnement des mises à jour de projet (project-details)');
      unsubscribe();
    };
  }, [project?.id]);

  // Note: Les suppressions de tâches sont gérées via les mises à jour de catégories

  // Note: Les suppressions de projets sont gérées via les mises à jour de catégories

  // 🗑️ S'abonner au vidage du cache
  useEffect(() => {
    console.log('🔔 Abonnement au vidage du cache (project-details)...');
    
    const unsubscribe = subscribeToCategoriesCleared(() => {
      console.log('🗑️ Cache vidé - Données en cache supprimées');
      // ✅ Ne pas rediriger, juste logger
      // L'utilisateur peut rafraîchir manuellement pour recharger les données
    });
    
    return () => {
      console.log('🧹 Désabonnement du vidage du cache (project-details)');
      unsubscribe();
    };
  }, []);

  const onRefresh = React.useCallback(async () => {
    if (!project) return;
    
    setRefreshing(true);
    const startTime = Date.now();
    
    try {
      console.log('🔄 Rafraîchissement COMPLET depuis project-details...');
      
      // ✅ FORCE REFRESH: Recharger TOUTES les catégories depuis l'API
      const response = await projectCategoryService.forceRefreshCategories();
      
      if (response.success && response.result) {
        // Chercher le projet mis à jour dans les catégories
        let updatedProject = null;
        for (const category of response.result) {
          if (category.project_ids && Array.isArray(category.project_ids)) {
            updatedProject = category.project_ids.find(p => p.id === project.id);
            if (updatedProject) break;
          }
        }
        
        if (updatedProject) {
          console.log('✅ Projet mis à jour:', updatedProject.name);
          // 🆕 Mettre à jour le projet avec les nouvelles données
          setProject(updatedProject);
          // 🆕 Forcer le re-render en incrémentant la clé
          setRefreshKey(prev => prev + 1);
          
          // 🔔 Afficher un alert pour informer l'utilisateur
          Alert.alert(
            '✅ Données mises à jour',
            `Le projet "${updatedProject.name}" et ses tâches ont été actualisés avec succès.`,
            [{ text: 'OK' }]
          );
        } else {
          // ❌ Projet filtré/supprimé - Redirect silencieux SANS alert
          console.warn('⚠️ Projet non trouvé après refresh - Redirection...');
          router.back();
        }
        
        console.log('✨ TOUTES les catégories ont été mises à jour (cascade)');
      } else {
        Alert.alert('Erreur', response.message || 'Impossible de rafraîchir les données');
      }
    } catch (error) {
      console.error('❌ Erreur refresh:', error);
      Alert.alert('Erreur', 'Impossible de rafraîchir les données');
    } finally {
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, 1000 - elapsedTime);
      
      setTimeout(() => {
        setRefreshing(false);
      }, remainingTime);
    }
  }, [project]);

  const getTaskStatusIcon = (state) => {
    switch (state) {
      case '1_done':
        return { name: 'checkmark-circle', color: '#10b981' };
      case '01_in_progress':
        return { name: 'play-circle', color: '#3b82f6' };
      case '1_canceled':
        return { name: 'close-circle', color: '#ef4444' };
      default:
        return { name: 'ellipse-outline', color: '#6b7280' };
    }
  };

  const getTaskStatusColors = (state) => {
    switch (state) {
      case '1_done':
        return {
          backgroundColor: '#f0fdf4', // Vert très clair
          borderColor: '#10b981',
          textColor: '#059669'
        };
      case '01_in_progress':
        return {
          backgroundColor: '#eff6ff', // Bleu très clair
          borderColor: '#3b82f6',
          textColor: '#2563eb'
        };
      case '1_canceled':
        return {
          backgroundColor: '#fef2f2', // Rouge très clair
          borderColor: '#ef4444',
          textColor: '#dc2626'
        };
      default:
        return {
          backgroundColor: '#f9fafb', // Gris très clair
          borderColor: '#e5e7eb',
          textColor: '#6b7280'
        };
    }
  };

  const getTaskStatusText = (state) => {
    switch (state) {
      case '1_done':
        return 'Terminée';
      case '01_in_progress':
        return 'En cours';
      case '1_canceled':
        return 'Annulée';
      default:
        return 'Non défini';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Date non définie';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const handleTaskPress = (task) => {
    console.log('🎯 Navigation vers dépenses de tâche:', task.name);
    router.push({
      pathname: '/(tabs)/task-expenses',
      params: {
        task: JSON.stringify(task),
        taskName: task.name,
        project: JSON.stringify(project), // 🆕 Passer le projet complet
        projectName: project.name
      }
    });
  };

  const TaskCard = ({ task }) => {
    const statusIcon = getTaskStatusIcon(task.state);
    const statusColors = getTaskStatusColors(task.state);
    const financials = calculateTaskFinancials(task);
    const [elapsedTime, ] = React.useState(0);

    const formatAmount = (amount: number): string => {
      return `${amount.toFixed(2)} DH`;
    };

    return (
      <TouchableOpacity
        style={styles.taskCard}
        onPress={() => handleTaskPress(task)}
        activeOpacity={0.7}
      >
        {/* Barre de statut colorée à gauche */}
        <View style={[styles.taskStatusBar, { backgroundColor: statusColors.borderColor }]} />
        
        <View style={styles.taskCardContent}>
          {/* Header avec icône et titre */}
          <View style={styles.taskCardHeader}>
            <View style={[styles.taskStatusIcon, { backgroundColor: statusColors.backgroundColor }]}>
              <Ionicons name={statusIcon.name} size={22} color={statusIcon.color} />
            </View>
            <View style={styles.taskTitleContainer}>
              <Text style={styles.taskTitle} numberOfLines={2}>{task.name}</Text>
              <View style={styles.taskHeaderBadges}>
                <View style={[styles.taskStatusBadge, { backgroundColor: statusColors.backgroundColor }]}>
                  <Text style={[styles.taskStatusText, { color: statusColors.textColor }]}>
                    {getTaskStatusText(task.state)}
                  </Text>
                </View>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" style={styles.taskChevron} />
          </View>

          {/* Informations de la tâche */}
          <View style={styles.taskDetails}>
            {task.user_ids && task.user_ids.length > 0 && (() => {
              // ✅ Extraire les noms des utilisateurs de manière robuste
              const userNames = task.user_ids
                .map((user: any) => {
                  const userInfo = getUserInfo(user);
                  return userInfo ? userInfo.name : null;
                })
                .filter((name: string | null) => name !== null);
              
              if (userNames.length === 0) return null;
              
              return (
                <View style={styles.taskInfoItem}>
                  <Text style={styles.taskInfoLabel}>Assignees:</Text>
                  <Text style={styles.taskInfoText} numberOfLines={1}>
                    {userNames.join(', ')}
                  </Text>
                </View>
              );
            })()}
            {task.partner_id && task.partner_id[0] && (
              <View style={styles.taskInfoItem}>
                <Ionicons name="business" size={14} color="#6b7280" />
                <Text style={styles.taskInfoText} numberOfLines={1}>
                  {task.partner_id[0].name}
                </Text>
              </View>
            )}
            {task.expense_ids && task.expense_ids.length > 0 && (
              <View style={styles.taskInfoItem}>
                <Ionicons name="wallet" size={14} color="#059669" />
                <Text style={[styles.taskInfoText, { color: '#059669', fontWeight: '600' }]}>
                  {task.expense_ids.length} dépense{task.expense_ids.length > 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>

          {/* Section avances (si présentes) */}
          {((task.advance_amount !== undefined && task.advance_amount !== null && task.advance_amount > 0) || task.advance_date) && (
            <View style={styles.taskAdvanceContainer}>
              <View style={styles.taskAdvanceDivider} />
              <View style={styles.taskAdvanceContent}>
                {/* Montant d'avance */}
                {task.advance_amount !== undefined && task.advance_amount !== null && task.advance_amount > 0 && (
                  <View style={styles.taskAdvanceBadge}>
                    <Ionicons name="cash" size={12} color="#10b981" />
                    <Text style={styles.taskAdvanceText}>
                      {task.advance_amount.toFixed(2)} MAD
                    </Text>
                  </View>
                )}
                {/* Date d'avance */}
                {task.advance_date && (
                  <View style={styles.taskAdvanceBadge}>
                    <Ionicons name="calendar" size={12} color="#3b82f6" />
                    <Text style={styles.taskAdvanceText}>
                      {formatDate(task.advance_date)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* ✅ Section Financière */}
          <View style={styles.taskFinancialSection}>
            <View style={styles.taskFinancialDivider} />
            <View style={styles.taskFinancialRow}>
              <View style={styles.taskFinancialItemSingle}>
                <Ionicons name="wallet-outline" size={12} color="#ef4444" />
                <Text style={styles.taskFinancialLabel}>Dépenses:</Text>
                <Text style={styles.taskFinancialExpense}>{formatAmount(financials.totalExpenses)}</Text>
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </>
    );
  }

  if (!project) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
          <Text style={styles.errorText}>Projet non trouvé</Text>
        </View>
      </>
    );
  }

  // ✅ Calculer les totaux financiers du projet
  const projectFinancials = (() => {
    let totalExpenses = 0;
    let totalSettlements = 0;

    if (project.tasks && Array.isArray(project.tasks)) {
      project.tasks.forEach((task: any) => {
        if (task.expense_ids && Array.isArray(task.expense_ids)) {
          task.expense_ids.forEach((expense: any) => {
            const amount = Math.abs(expense.solde_amount ?? expense.amount ?? expense.balance ?? 0);
            if (expense.expense_move_type === 'replenish') {
              totalSettlements += amount;
            } else if (expense.expense_move_type === 'spent') {
              totalExpenses += amount;
            }
          });
        }
      });
    }

    return { totalExpenses, totalSettlements, balance: totalSettlements - totalExpenses };
  })();

  const formatAmount = (amount: number): string => {
    return `${amount.toFixed(2)} DH`;
  };

  const tasksStats = {
    total: project.tasks?.length || 0,
    done: project.tasks?.filter(task => task.state === '1_done').length || 0,
    inProgress: project.tasks?.filter(task => task.state === '01_in_progress').length || 0,
    canceled: project.tasks?.filter(task => task.state === '1_canceled').length || 0,
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#2563eb" />

      {/* Fixed Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project.name}
          </Text>
          {project.numero && (
            <Text style={styles.headerSubtitle}>{project.numero}</Text>
          )}
        </View>
        <TouchableOpacity style={styles.moreButton}>
          <Ionicons name="ellipsis-vertical" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        key={refreshKey} // 🆕 Utiliser la clé pour forcer le re-render
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            progressViewOffset={140} // 🆕 Espace en bas du header (hauteur header ≈ 120px + marge)
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Breadcrumb */}
        <Breadcrumb 
          items={[
            {
              label: 'Projets',
              icon: 'home-outline',
              onPress: () => router.push('/(tabs)/')
            },
            {
              label: project.name,
              icon: 'briefcase',
              // Pas de onPress = page actuelle, non cliquable
            }
          ]}
        />

        {/* Project Info Card with Statistics */}
        <View style={styles.projectInfoCard}>
          {/* En-tête avec titre */}
          <View style={styles.projectInfoHeader}>
            <View style={styles.projectInfoTitleContainer}>
              <Text style={styles.projectInfoTitle}>{project.name}</Text>
              {project.numero && (
                <View style={styles.numeroChip}>
                  <Ionicons name="pricetag" size={12} color="#3b82f6" />
                  <Text style={styles.projectInfoNumero}>#{project.numero}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Séparateur */}
          <View style={styles.projectInfoDivider} />
          
          {/* Informations principales */}
          <View style={styles.projectInfoSection}>
            {/* Client */}
            {project.partner_id && project.partner_id[0] && (
              <View style={styles.projectInfoRow}>
                <View style={styles.projectInfoLabelContainer}>
                  <Ionicons name="business-outline" size={18} color="#6b7280"/>
                  <Text style={styles.projectInfoLabel}>Client</Text>
                </View>
                <Text style={styles.projectInfoValue} numberOfLines={2}>
                  {project.partner_id[0].name}
                </Text>
              </View>
            )}

            {/* Types de projet */}
            {project.type_ids && project.type_ids.length > 0 && (
              <View style={styles.projectInfoRow}>
                <View style={styles.projectInfoLabelContainer}>
                  <Ionicons name="layers-outline" size={18} color="#8b5cf6"/>
                  <Text style={styles.projectInfoLabel}>Types</Text>
                </View>
                <View style={styles.projectTypesContainer}>
                  {project.type_ids.map((type, index) => (
                    <View key={type.id} style={styles.projectTypeChip}>
                      <Ionicons name="layers" size={12} color="#8b5cf6" />
                      <Text style={styles.projectTypeText}>{type.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Date de création */}
            {project.create_date && (
              <View style={styles.projectInfoRow}>
                <View style={styles.projectInfoLabelContainer}>
                  <Ionicons name="calendar-outline" size={18} color="#3b82f6"/>
                  <Text style={styles.projectInfoLabel}>Créé le</Text>
                </View>
                <Text style={styles.projectInfoValue}>
                  {new Date(project.create_date).toLocaleDateString('fr-FR', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric'
                  })}
                </Text>
              </View>
            )}

            {/* Source du projet */}
            {project.project_source && (
              <View style={styles.projectInfoRow}>
                <View style={styles.projectInfoLabelContainer}>
                  <Ionicons name="flag-outline" size={18} color="#10b981"/>
                  <Text style={styles.projectInfoLabel}>Source</Text>
                </View>
                <View style={[
                  styles.projectSourceBadge,
                  project.project_source === 'client' && styles.projectSourceBadgePrivate,
                  project.project_source === 'marche_public' && styles.projectSourceBadgePublic
                ]}>
                  <Ionicons 
                    name={project.project_source === 'client' ? 'person' : 'globe'} 
                    size={12} 
                    color={project.project_source === 'client' ? '#8b5cf6' : '#10b981'} 
                  />
                  <Text style={[
                    styles.projectSourceText,
                    project.project_source === 'client' && styles.projectSourceTextPrivate,
                    project.project_source === 'marche_public' && styles.projectSourceTextPublic
                  ]}>
                    {project.project_source === 'client' ? 'Privé' : 'Public'}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Séparateur avant statistiques */}
          <View style={styles.projectInfoDivider} />

          {/* ✅ Section Financière du Projet */}
          <View style={styles.projectFinancialSection}>
            <View style={styles.projectFinancialHeader}>
              <Ionicons name="wallet" size={18} color="#ef4444" />
              <Text style={styles.projectFinancialTitle}>Dépenses</Text>
            </View>
            <View style={styles.projectFinancialSingle}>
              <Text style={styles.projectFinancialAmount}>{formatAmount(projectFinancials.totalExpenses)}</Text>
            </View>
          </View>

          {/* Séparateur avant statistiques */}
          <View style={styles.projectInfoDivider} />

          {/* Statistiques des tâches */}
          <View style={styles.statsSection}>
            <View style={styles.statsSectionHeader}>
              <Ionicons name="stats-chart" size={18} color="#8b5cf6" />
              <Text style={styles.statsSectionTitle}>Statistiques des tâches</Text>
            </View>
            <View style={styles.statsGrid}>
              <TouchableOpacity
                style={[
                  styles.statItem,
                  statusFilter === 'all' && styles.statItemActive
                ]}
                onPress={() => setStatusFilter('all')}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.statValue,
                  statusFilter === 'all' && styles.statValueActive
                ]}>{tasksStats.total}</Text>
                <Text style={[
                  styles.statLabel,
                  statusFilter === 'all' && styles.statLabelActive
                ]}>Total</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statItem,
                  statusFilter === '1_done' && styles.statItemActive
                ]}
                onPress={() => setStatusFilter('1_done')}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.statValue,
                  { color: statusFilter === '1_done' ? '#ffffff' : '#10b981' }
                ]}>{tasksStats.done}</Text>
                <Text style={[
                  styles.statLabel,
                  statusFilter === '1_done' && styles.statLabelActive
                ]}>Terminées</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statItem,
                  statusFilter === '01_in_progress' && styles.statItemActive
                ]}
                onPress={() => setStatusFilter('01_in_progress')}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.statValue,
                  { color: statusFilter === '01_in_progress' ? '#ffffff' : '#3b82f6' }
                ]}>{tasksStats.inProgress}</Text>
                <Text style={[
                  styles.statLabel,
                  statusFilter === '01_in_progress' && styles.statLabelActive
                ]}>En cours</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statItem,
                  statusFilter === '1_canceled' && styles.statItemActive
                ]}
                onPress={() => setStatusFilter('1_canceled')}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.statValue,
                  { color: statusFilter === '1_canceled' ? '#ffffff' : '#ef4444' }
                ]}>{tasksStats.canceled}</Text>
                <Text style={[
                  styles.statLabel,
                  statusFilter === '1_canceled' && styles.statLabelActive
                ]}>Annulées</Text>
              </TouchableOpacity>
            </View>
          </View>

        </View>

        {/* Search Filter */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher une tâche..."
              placeholderTextColor="#9ca3af"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                style={styles.clearButton}
              >
                <Ionicons name="close-circle" size={20} color="#9ca3af" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Tasks List */}
        <View style={styles.tasksContainer}>
          <View style={styles.tasksHeader}>
            <View style={styles.taskHeaderTop}>
              <Text style={styles.sectionTitle}>
                Tâches du projet
              </Text>
              {(searchQuery.trim() || statusFilter !== 'all') && (() => {
                // Calculer le nombre de tâches filtrées
                let filtered = (project.tasks || []).filter(task => {
                  if (!searchQuery.trim()) return true;
                  const query = searchQuery.toLowerCase().trim();
                  return (
                    task.name.toLowerCase().includes(query) ||
                    task.state.toLowerCase().includes(query) ||
                    // ✅ Recherche avec getUserInfo
                (task.user_ids && task.user_ids.some((user: any) => {
                  const userInfo = getUserInfo(user);
                  return userInfo && userInfo.name.toLowerCase().includes(query);
                })) ||
                    (task.partner_id && task.partner_id[0]?.name?.toLowerCase().includes(query))
                  );
                });
                if (statusFilter !== 'all') {
                  filtered = filtered.filter(task => task.state === statusFilter);
                }
                return (
                  <Text style={styles.resultCount}>
                    {filtered.length} résultat{filtered.length > 1 ? 's' : ''}
                  </Text>
                );
              })()}
            </View>
            <View style={styles.progressIndicator}>
              <Text style={styles.progressText}>
                {tasksStats.done}/{tasksStats.total - tasksStats.canceled} complétées
              </Text>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${(tasksStats.total - tasksStats.canceled) > 0 ? (tasksStats.done / (tasksStats.total - tasksStats.canceled)) * 100 : 0}%` }
                  ]}
                />
              </View>
            </View>
          </View>

          {(() => {
            // Appliquer le filtre de recherche
            let filteredTasks = (project.tasks || []).filter(task => {
              if (!searchQuery.trim()) return true;
              const query = searchQuery.toLowerCase().trim();
              // ✅ Recherche améliorée avec getUserInfo
              const matchesName = task.name.toLowerCase().includes(query);
              const matchesState = task.state.toLowerCase().includes(query);
              
              // Vérifier les utilisateurs avec getUserInfo
              const matchesUser = task.user_ids && task.user_ids.some((user: any) => {
                const userInfo = getUserInfo(user);
                return userInfo && userInfo.name.toLowerCase().includes(query);
              });
              
              const matchesPartner = task.partner_id && task.partner_id[0]?.name?.toLowerCase().includes(query);
              
              return matchesName || matchesState || matchesUser || matchesPartner;
            });

            // Appliquer le filtre de statut
            if (statusFilter !== 'all') {
              filteredTasks = filteredTasks.filter(task => task.state === statusFilter);
            }

            return filteredTasks.length > 0 ? (
              filteredTasks.map((task, index) => (
                <TaskCard key={task.id || index} task={task} />
              ))
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name={searchQuery.trim() || statusFilter !== 'all' ? "search-outline" : "clipboard-outline"} size={48} color="#9ca3af" />
                <Text style={styles.emptyText}>
                  {searchQuery.trim() || statusFilter !== 'all' ? 'Aucune tâche trouvée' : 'Aucune tâche dans ce projet'}
                </Text>
                {(searchQuery.trim() || statusFilter !== 'all') && (
                  <TouchableOpacity
                    onPress={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                    }}
                    style={styles.clearFiltersButton}
                  >
                    <Text style={styles.clearFiltersText}>Réinitialiser les filtres</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}
        </View>
      </ScrollView>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    backgroundColor: '#2563eb',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999, // 🆕 Réduit pour que le RefreshControl (z-index par défaut très élevé) passe au-dessus
    shadowColor: '#2563eb',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 2,
    fontWeight: '500',
  },
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 140, // Compenser la hauteur du header fixe
    paddingBottom: 100, // Compenser la hauteur de la tab bar
  },
  breadcrumbWrapper: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingVertical: 12,
  },
  breadcrumbScrollView: {
    flexGrow: 0,
  },
  breadcrumbScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 4,
    minWidth: 'auto',
  },
  breadcrumbText: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 4,
    fontWeight: '500',
  },
  breadcrumbActive: {
    color: '#3b82f6',
    fontWeight: '600',
  },
  projectInfoCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 16,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#f0f9ff',
  },
  projectInfoHeader: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
    backgroundColor: '#fafafe',
  },
  projectInfoTitleContainer: {
    gap: 12,
  },
  projectInfoTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1e293b',
    lineHeight: 32,
    letterSpacing: 0.3,
  },
  numeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#bfdbfe',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  projectInfoNumero: {
    fontSize: 15,
    color: '#1e40af',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  projectInfoDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginHorizontal: 20,
  },
  projectInfoSection: {
    padding: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  projectInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  projectInfoLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 80,
  },
  projectInfoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  projectInfoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1f2937',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  // Styles pour les types de projet
  projectTypesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
    justifyContent: 'flex-end',
  },
  projectTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#f5f3ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e9d5ff',
  },
  projectTypeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8b5cf6',
    letterSpacing: 0.3,
  },
  // Styles pour la source du projet
  projectSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  projectSourceBadgePrivate: {
    backgroundColor: '#f5f3ff',
    borderColor: '#e9d5ff',
  },
  projectSourceBadgePublic: {
    backgroundColor: '#f0fdf4',
    borderColor: '#d1fae5',
  },
  projectSourceText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  projectSourceTextPrivate: {
    color: '#8b5cf6',
  },
  projectSourceTextPublic: {
    color: '#10b981',
  },
  // ✅ Styles pour la section financière du projet
  projectFinancialSection: {
    padding: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  projectFinancialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  projectFinancialTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ef4444',
  },
  projectFinancialSingle: {
    backgroundColor: '#fef2f2',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  projectFinancialAmount: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ef4444',
  },
  // ✅ Styles pour la section pointage
  taskPointerSection: {
    marginTop: 12,
  },
  taskPointerDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginBottom: 10,
  },
  taskPointerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8b5cf6',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    gap: 8,
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
    position: 'relative',
  },
  taskPointerButtonPointed: {
    backgroundColor: '#10b981',
    shadowColor: '#10b981',
  },
  taskPointerButtonLoading: {
    backgroundColor: '#6b7280',
    shadowOpacity: 0,
    elevation: 0,
  },
  taskPointerButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  taskPointerBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#10b981',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  // Section statistiques dans la carte projet
  statsSection: {
    padding: 20,
    paddingTop: 16,
    paddingBottom: 20,
    backgroundColor: '#faf5ff',
  },
  statsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  statsSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#8b5cf6',
    letterSpacing: 0.2,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  statItem: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 12,
    flex: 1,
  },
  statItemActive: {
    backgroundColor: '#8b5cf6',
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 3,
  },
  statValueActive: {
    color: '#ffffff',
  },
  statLabel: {
    fontSize: 10,
    color: '#6b7280',
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 14,
  },
  statLabelActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  // Tasks Section
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 16,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  clearButton: {
    padding: 4,
  },
  tasksContainer: {
    paddingHorizontal: 20,
  },
  tasksHeader: {
    marginBottom: 16,
  },
  taskHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  resultCount: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '600',
  },
  progressIndicator: {
    marginTop: 8,
    alignItems: 'flex-end',
  },
  progressText: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
    fontWeight: '500',
  },
  progressBar: {
    width: 120,
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 2,
  },
  taskCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  taskStatusBar: {
    width: 5,
  },
  taskCardContent: {
    flex: 1,
    padding: 18,
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  taskStatusIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  taskTitleContainer: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 8,
    lineHeight: 24,
    letterSpacing: 0.2,
  },
  taskHeaderBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  taskStatusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  taskStatusText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  taskChevron: {
    marginLeft: 8,
    marginTop: 2,
  },
  taskDetails: {
    gap: 8,
  },
  taskInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskInfoLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '600',
  },
  taskInfoText: {
    fontSize: 13,
    color: '#8b5cf6',
    fontWeight: '600',
    flex: 1,
  },
  // Section avances dans TaskCard
  taskAdvanceContainer: {
    marginTop: 12,
  },
  taskAdvanceDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginBottom: 10,
  },
  taskAdvanceContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  taskAdvanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  taskAdvanceText: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '600',
  },
  // ✅ Styles pour la section financière des tâches
  taskFinancialSection: {
    marginTop: 12,
  },
  taskFinancialDivider: {
    height: 1,
    backgroundColor: '#f3f4f6',
    marginBottom: 8,
  },
  taskFinancialRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  taskFinancialItemSingle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskFinancialLabel: {
    fontSize: 10,
    color: '#6b7280',
    fontWeight: '500',
  },
  taskFinancialExpense: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ef4444',
    marginLeft: 4,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 12,
    textAlign: 'center',
  },
  clearFiltersButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#eff6ff',
    borderRadius: 8,
  },
  clearFiltersText: {
    fontSize: 14,
    color: '#3b82f6',
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2563eb',
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 16,
    marginTop: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dc2626',
  },
  errorText: {
    color: '#ffffff',
    fontSize: 16,
  },
});
