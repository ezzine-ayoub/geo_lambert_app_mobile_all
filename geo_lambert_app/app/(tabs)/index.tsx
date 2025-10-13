import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  StatusBar,
  Dimensions,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUserAuth, useCurrentUser } from '@/contexts/UserAuthContext';
import { router, useFocusEffect } from 'expo-router';
import projectService, { subscribeToProjectUpdates, subscribeToProjectsCleared, subscribeToProjectDeleted } from '@/services/projectService';
import { useCallback } from 'react';

const { width } = Dimensions.get('window');

export default function HomeScreen() {
  const { refreshSession, error } = useUserAuth();
  const user = useCurrentUser();
  const [refreshing, setRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalProjects: 0,
    totalTasks: 0,
    completedTasks: 0,
    inProgressTasks: 0,
    completionRate: 0,
    situationProjects: 0,
    normalProjects: 0,
    totalExpenses: 0,
    expenseCount: 0
  });

  // Animation pour l'icône de refresh
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (refreshing) {
      // Démarrer l'animation de rotation
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start();
      
      // Animation de fade in et scale
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Réinitialiser les animations
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.8,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start(() => {
        rotateAnim.setValue(0);
      });
    }
  }, [refreshing]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ✅ Charger les données au démarrage
  useEffect(() => {
    loadProjects();
  }, []);

  // 🗑️ S'abonner aux suppressions de projets WebSocket
  useEffect(() => {
    console.log('🔔 Abonnement aux suppressions de projets WebSocket...');
    
    const unsubscribe = subscribeToProjectDeleted((deletedProjectId) => {
      console.log('🗑️ Projet supprimé via WebSocket:', deletedProjectId);
      
      // Retirer le projet supprimé du state
      setProjects(prevProjects => {
        const filteredProjects = prevProjects.filter(p => p.id !== deletedProjectId);
        console.log(`✅ Projet ${deletedProjectId} retiré du state (${prevProjects.length} -> ${filteredProjects.length})`);
        
        // Recalculer les stats
        const newStats = projectService.calculateProjectStats(filteredProjects);
        setStats(newStats);
        
        return filteredProjects;
      });
    });
    
    return () => {
      console.log('🧹 Désabonnement des suppressions de projets');
      unsubscribe();
    };
  }, []);

  // 🔄 S'abonner aux mises à jour WebSocket
  useEffect(() => {
    console.log('🔔 Abonnement aux mises à jour de projets WebSocket...');
    
    const unsubscribe = subscribeToProjectUpdates(async (updatedProject) => {
      console.log('🔄 Projet mis à jour via WebSocket:', updatedProject.id);
      
      // Mettre à jour le state local
      setProjects(prevProjects => {
        const existingIndex = prevProjects.findIndex(p => p.id === updatedProject.id);
        
        if (existingIndex >= 0) {
          // Remplacer le projet existant
          const newProjects = [...prevProjects];
          newProjects[existingIndex] = updatedProject;
          console.log(`✅ Projet ${updatedProject.id} mis à jour dans le state`);
          return newProjects;
        } else {
          // Ajouter le nouveau projet
          console.log(`➕ Nouveau projet ${updatedProject.id} ajouté au state`);
          return [...prevProjects, updatedProject];
        }
      });
      
      // Recalculer les stats
      const allProjects = await projectService.loadProjectsFromCache();
      const calculatedStats = projectService.calculateProjectStats(allProjects);
      setStats(calculatedStats);
    });
    
    // Nettoyage à la désactivation du composant
    return () => {
      console.log('🧹 Désabonnement des mises à jour de projets');
      unsubscribe();
    };
  }, []);

  // 🗑️ S'abonner au vidage du cache
  useEffect(() => {
    console.log('🔔 Abonnement au vidage du cache...');
    
    const unsubscribe = subscribeToProjectsCleared(() => {
      console.log('🗑️ Cache vidé - Réinitialisation des projets');
      
      // Réinitialiser les states
      setProjects([]);
      setStats({
        totalProjects: 0,
        totalTasks: 0,
        completedTasks: 0,
        inProgressTasks: 0,
        completionRate: 0,
        situationProjects: 0,
        normalProjects: 0,
        totalExpenses: 0,
        expenseCount: 0
      });
    });
    
    return () => {
      console.log('🧹 Désabonnement du vidage du cache');
      unsubscribe();
    };
  }, []);

  // ✅ Recharger automatiquement quand on revient sur la page (détecte cache vidé)
  useFocusEffect(
    useCallback(() => {
      console.log('🔄 Page focusée - vérification des données...');
      // Vérifier si on a des projets, sinon recharger
      if (projects.length === 0 && !loading) {
        console.log('📂 Aucun projet en mémoire, rechargement...');
        loadProjects();
      }
    }, [projects.length, loading])
  );

  // Fonction pour récupérer les projets depuis le service
  const loadProjects = async () => {
    try {
      setLoading(true);
      console.log('📊 Chargement des projets via taskService...');
      
      const response = await projectService.getProjects();
      
      if (response.success && response.result) {
        // @ts-ignore
          setProjects(response.result);
        const calculatedStats = projectService.calculateProjectStats(response.result);
        setStats(calculatedStats);
        console.log(`📊 ${response.result.length} projets chargés via service`);
      } else {
        console.warn('⚠️ Erreur service projets:', response.message);
        throw new Error(response.message || 'Erreur de récupération des projets');
      }

    } catch (error) {
      console.error('❌ Erreur chargement projets:', error);
      // En cas d'erreur, on peut décider de garder les anciennes données ou les vider
      if (projects.length === 0) {
        // Si on n'a pas de données précédentes, on met des valeurs par défaut
        setStats({
          totalProjects: 0,
          totalTasks: 0,
          completedTasks: 0,
          inProgressTasks: 0,
          completionRate: 0,
          situationProjects: 0,
          normalProjects: 0,
          totalExpenses: 0,
          expenseCount: 0
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    const startTime = Date.now();
    
    try {
      // Force refresh from API
      console.log('🔄 Pull-to-refresh: forçage du rafraîchissement...');
      const response = await projectService.forceRefreshProjects();
      
      if (response.success && response.result) {
        setProjects(response.result);
        const calculatedStats = projectService.calculateProjectStats(response.result);
        setStats(calculatedStats);
        console.log(`✅ ${response.result.length} projets rafraîchis`);
      } else {
        console.warn('⚠️ Erreur refresh:', response.message);
      }
      
      // Also refresh session
      await refreshSession();
    } catch (error) {
      console.error('❌ Erreur refresh:', error);
    } finally {
      // Assurer un délai minimum de 1 seconde
      const elapsedTime = Date.now() - startTime;
      const remainingTime = Math.max(0, 1000 - elapsedTime);
      
      setTimeout(() => {
        setRefreshing(false);
      }, remainingTime);
    }
  }, [refreshSession]);

  const QuickActionCard = ({ icon, title, description, onPress, color = '#2563eb' }) => (
    <TouchableOpacity style={styles.actionCard} onPress={onPress}>
      <View style={[styles.actionIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <View style={styles.actionContent}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
    </TouchableOpacity>
  );

  const StatCard = ({ icon, value, label, color = '#2563eb' }) => (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  const formatTime = (date) => {
    return date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleProjectPress = (project) => {
    console.log('🎯 Navigation vers projet:', project.name);
    router.push({
      pathname: '/(tabs)/project-details',
      params: {
        project: JSON.stringify(project),
        projectName: project.name
      }
    });
  };

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Bonjour';
    if (hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
      
      {/* Refresh Overlay - Fixed Center */}
      {refreshing && (
        <Animated.View style={[styles.refreshOverlay, { opacity: fadeAnim }]}>
          <Animated.View style={[styles.refreshCard, { transform: [{ scale: scaleAnim }] }]}>
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <Ionicons name="reload" size={40} color="#3b82f6" />
            </Animated.View>
            <Text style={styles.refreshOverlayText}>Actualisation...</Text>
          </Animated.View>
        </Animated.View>
      )}
      
      {/* Fixed Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>
              {getGreeting()}{user?.display_name ? `, ${user.display_name.split(' ')[0]}` : ''}
            </Text>
            <Text style={styles.date}>{formatDate(currentTime)}</Text>
          </View>
        </View>
      </View>
      
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl 
            refreshing={false}
            onRefresh={onRefresh}
            colors={['#2563eb']}
            tintColor="#2563eb"
          />
        }
        showsVerticalScrollIndicator={false}
      >

        {/* Company Banner */}
        <View style={styles.companyBanner}>
          <Image
            source={require('../../assets/images/geo-lambert.png')}
            style={styles.companyLogo}
            resizeMode="contain"
          />
          <View style={styles.companyInfo}>
            <Text style={styles.companyName}>GEO LAMBERT</Text>
            <Text style={styles.companySlogan}>L'Art de mesure et de précision</Text>
            <Text style={styles.companyDescription}>
              Solutions géomatiques professionnelles
            </Text>
          </View>
        </View>

        {/* Stats Section */}
        <View style={styles.statsContainer}>
          <Text style={styles.sectionTitle}>Aperçu</Text>
          {loading ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Chargement des données...</Text>
            </View>
          ) : (
            <View style={styles.statsGrid}>
              <StatCard
                icon="briefcase-outline"
                value={stats.totalProjects.toString()}
                label="Projets"
                color="#10b981"
              />
              <StatCard
                icon="list-outline"
                value={stats.totalTasks.toString()}
                label="Tâches"
                color="#3b82f6"
              />
              <StatCard
                icon="analytics-outline"
                value={`${stats.completionRate || 0}%`}
                label="Complétion"
                color="#8b5cf6"
              />
              <StatCard
                icon="wallet-outline"
                value={stats.expenseCount.toString()}
                label="Dépenses"
                color="#ef4444"
              />
            </View>
          )}
        </View>

        {/* Recent Projects */}
        <View style={styles.activityContainer}>
          <Text style={styles.sectionTitle}>Projets récents</Text>
          
          {loading ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Chargement des projets...</Text>
            </View>
          ) : projects.length > 0 ? (
            projects.map(project => (
              <TouchableOpacity 
                key={project.id} 
                style={styles.projectCard}
                onPress={() => handleProjectPress(project)}
                activeOpacity={0.7}
              >
                {/* Barre de couleur à gauche */}
                <View style={[
                  styles.projectColorBar,
                  { backgroundColor: project.project_type === 'situation' ? '#8b5cf6' : '#2563eb' }
                ]} />

                <View style={styles.projectCardContent}>
                  {/* Header avec icône et titre */}
                  <View style={styles.projectCardHeader}>
                    <View style={[
                      styles.projectIconContainer,
                      { backgroundColor: project.project_type === 'situation' ? '#f3e8ff' : '#eff6ff' }
                    ]}>
                      <Ionicons 
                        name={project.project_type === 'situation' ? 'location' : 'briefcase'} 
                        size={22} 
                        color={project.project_type === 'situation' ? '#8b5cf6' : '#2563eb'} 
                      />
                    </View>
                    <View style={styles.projectTitleContainer}>
                      <Text style={styles.projectTitle} numberOfLines={1}>{project.name}</Text>
                      {project.numero && (
                        <View style={styles.numeroChip}>
                          <Ionicons name="pricetag" size={10} color="#3b82f6" />
                          <Text style={styles.numeroText}>#{project.numero}</Text>
                        </View>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#9ca3af" style={styles.projectChevron} />
                  </View>

                  {/* Informations du projet */}
                  <View style={styles.projectDetails}>
                    {/* Tâches */}
                    <View style={styles.projectInfoItem}>
                      <Ionicons name="list" size={14} color="#6b7280" />
                      <Text style={styles.projectInfoText}>
                        {project.task_ids?.length || 0} tâche{(project.task_ids?.length || 0) > 1 ? 's' : ''}
                      </Text>
                    </View>
                    {/* Client */}
                    {project.partner_id && project.partner_id[0] && (
                      <View style={styles.projectInfoItem}>
                        <Ionicons name="business" size={14} color="#6b7280" />
                        <Text style={styles.projectInfoText} numberOfLines={1}>
                          {project.partner_id[0].name}
                        </Text>
                      </View>
                    )}
                    {/* Date */}
                    {project.date_start && (
                      <View style={styles.projectInfoItem}>
                        <Ionicons name="calendar" size={14} color="#6b7280" />
                        <Text style={styles.projectInfoText}>
                          {new Date(project.date_start).toLocaleDateString('fr-FR')}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="briefcase-outline" size={48} color="#9ca3af" />
              <Text style={styles.emptyText}>Aucun projet trouvé</Text>
            </View>
          )}
        </View>

        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="warning" size={20} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>GEO LAMBERT</Text>
          <Text style={styles.footerSubtext}>
            Expertise géomatique depuis 1985
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  refreshOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  refreshCard: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 32,
    paddingVertical: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  refreshOverlayText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 140, // Compenser la hauteur du header fixe
  },
  header: {
    backgroundColor: '#2563eb',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  date: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textTransform: 'capitalize',
  },
  time: {
    fontSize: 32,
    fontWeight: '300',
    color: '#ffffff',
  },
  companyBanner: {
    backgroundColor: '#ffffff',
    margin: 20,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  companyLogo: {
    width: 80,
    height: 48,
    marginRight: 16,
  },
  companyInfo: {
    flex: 1,
  },
  companyName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2563eb',
    marginBottom: 4,
  },
  companySlogan: {
    fontSize: 14,
    color: '#6b7280',
    fontStyle: 'italic',
    marginBottom: 2,
  },
  companyDescription: {
    fontSize: 12,
    color: '#9ca3af',
  },
  statsContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statCard: {
    backgroundColor: '#ffffff',
    width: (width - 60) / 2,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  actionsContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  actionCard: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 2,
  },
  actionDescription: {
    fontSize: 14,
    color: '#6b7280',
  },
  activityContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#eff6ff',
    borderRadius: 20,
  },
  viewAllText: {
    fontSize: 12,
    color: '#3b82f6',
    fontWeight: '600',
    marginRight: 4,
  },
  activityCard: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1f2937',
    marginBottom: 2,
  },
  activityTime: {
    fontSize: 12,
    color: '#6b7280',
  },
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  footerText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2563eb',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '500',
  },
  projectCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    flexDirection: 'row',
  },
  projectColorBar: {
    width: 4,
  },
  projectCardContent: {
    flex: 1,
    padding: 16,
  },
  projectCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  projectIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  projectTitleContainer: {
    flex: 1,
  },
  projectTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: 4,
    lineHeight: 22,
  },
  numeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  numeroText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3b82f6',
    letterSpacing: 0.3,
  },
  projectChevron: {
    marginLeft: 8,
  },
  projectDetails: {
    gap: 8,
  },
  projectInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  projectInfoText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
    flex: 1,
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
});
