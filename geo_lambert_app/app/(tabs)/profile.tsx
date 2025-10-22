import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  RefreshControl,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUserAuth, useCurrentUser } from '@/contexts/UserAuthContext';

export default function ProfileScreen() {
  const { logout, refreshSession, error, isLoading } = useUserAuth();
  const user = useCurrentUser();
  const [refreshing, setRefreshing] = useState(false);

  // Function to get user initials
  const getUserInitials = (displayName) => {
    if (!displayName) return 'U';
    const names = displayName.trim().split(' ');
    if (names.length === 1) {
      return names[0].charAt(0).toUpperCase();
    }
    return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
  };

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshSession();
    } catch (error) {
      console.error('Erreur refresh:', error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshSession]);

  const handleLogout = () => {
    Alert.alert(
      'Déconnexion',
      'Êtes-vous sûr de vouloir vous déconnecter ?',
      [
        {
          text: 'Annuler',
          style: 'cancel',
        },
        {
          text: 'Déconnexion',
          style: 'destructive',
          onPress: logout,
        },
      ],
    );
  };

  const handleEditProfile = () => {
    Alert.alert(
      'Modification du profil',
      'Cette fonctionnalité sera disponible prochainement.',
      [{ text: 'OK' }]
    );
  };

  const handleSettings = () => {
    Alert.alert(
      'Paramètres',
      'Cette fonctionnalité sera disponible prochainement.',
      [{ text: 'OK' }]
    );
  };

  const handleHelp = () => {
    Alert.alert(
      'Aide & Support',
      'Pour obtenir de l\'aide, contactez l\'équipe support GEO LAMBERT.\n\nEmail: support@geo-lambert.com\nTéléphone: +33 1 XX XX XX XX',
      [{ text: 'OK' }]
    );
  };

  const ProfileItem = ({ icon, title, subtitle, onPress, showChevron = true }) => (
    <TouchableOpacity style={styles.profileItem} onPress={onPress}>
      <View style={styles.profileItemLeft}>
        <View style={styles.iconContainer}>
          <Ionicons name={icon} size={22} color="#2563eb" />
        </View>
        <View style={styles.profileItemContent}>
          <Text style={styles.profileItemTitle}>{title}</Text>
          {subtitle && <Text style={styles.profileItemSubtitle}>{subtitle}</Text>}
        </View>
      </View>
      {showChevron && (
        <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
      
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Mon Profil</Text>
        </View>

        {/* User Profile Card */}
        <View style={styles.profileCard}>
          {/* Logo Section */}
          <View style={styles.logoSection}>
            <Image
              source={require('../../assets/images/geo-lambert.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.companyName}>GEO LAMBERT</Text>
            <Text style={styles.companySlogan}>L'Art de mesure et de précision</Text>
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.profileHeader}>
            <View style={styles.avatarContainer}>
              <View style={styles.avatarInitials}>
                <Text style={styles.initialsText}>
                  {getUserInitials(user?.display_name || user?.username)}
                </Text>
              </View>
              <View style={styles.statusBadge}>
                <View style={styles.statusDot} />
              </View>
            </View>
            
            <View style={styles.profileInfo}>
              <Text style={styles.userName}>{user?.display_name || user?.username || 'Utilisateur'}</Text>
              <Text style={styles.userEmail}>{user?.email || 'Email non disponible'}</Text>
              {user?.company_name && (
                <View style={styles.companyBadge}>
                  <Ionicons name="business" size={14} color="#2563eb" />
                  <Text style={styles.companyText}>{user.company_name}</Text>
                </View>
              )}
            </View>
            
            <TouchableOpacity style={styles.editButton} onPress={handleEditProfile}>
              <Ionicons name="pencil" size={16} color="#2563eb" />
            </TouchableOpacity>
          </View>

          {/* User Details */}
          {user && (
            <View style={styles.userDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>ID Utilisateur</Text>
                <Text style={styles.detailValue}>#{user.id}</Text>
              </View>
              
              {user.phone && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Téléphone</Text>
                  <Text style={styles.detailValue}>{user.phone}</Text>
                </View>
              )}
              
              {user.city && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Ville</Text>
                  <Text style={styles.detailValue}>{user.city}</Text>
                </View>
              )}
              
              {user.is_admin && (
                <View style={styles.adminBadge}>
                  <Ionicons name="shield-checkmark" size={14} color="#ffffff" />
                  <Text style={styles.adminText}>Administrateur</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Menu Items */}
        <View style={styles.menuSection}>
          <Text style={styles.sectionTitle}>Compte</Text>
          
          <ProfileItem
            icon="person-circle-outline"
            title="Modifier le profil"
            subtitle="Informations personnelles"
            onPress={handleEditProfile}
          />
          
          <ProfileItem
            icon="settings-outline"
            title="Paramètres"
            subtitle="Préférences de l'application"
            onPress={handleSettings}
          />
          
          <ProfileItem
            icon="notifications-outline"
            title="Notifications"
            subtitle="Gérer les notifications"
            onPress={() => Alert.alert('Notifications', 'Fonctionnalité à venir')}
          />
        </View>

        <View style={styles.menuSection}>
          <Text style={styles.sectionTitle}>Support</Text>
          
          <ProfileItem
            icon="help-circle-outline"
            title="Aide & Support"
            subtitle="Contactez notre équipe"
            onPress={handleHelp}
          />
          
          <ProfileItem
            icon="document-text-outline"
            title="Conditions d'utilisation"
            subtitle="Termes et conditions"
            onPress={() => Alert.alert('CGU', 'Fonctionnalité à venir')}
          />
          
          <ProfileItem
            icon="shield-outline"
            title="Politique de confidentialité"
            subtitle="Protection de vos données"
            onPress={() => Alert.alert('Confidentialité', 'Fonctionnalité à venir')}
          />
        </View>

        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <Ionicons name="warning" size={20} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Logout Button */}
        <View style={styles.logoutSection}>
          <TouchableOpacity 
            style={styles.logoutButton} 
            onPress={handleLogout}
            disabled={isLoading}
          >
            <Ionicons name="log-out-outline" size={20} color="#dc2626" />
            <Text style={styles.logoutText}>
              {isLoading ? 'Déconnexion...' : 'Se déconnecter'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>GEO LAMBERT</Text>
          <Text style={styles.footerSubtext}>Solutions géomatiques professionnelles</Text>
          <Text style={styles.versionText}>Version 1.0.0</Text>
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
  scrollView: {
    flex: 1,
  },
  header: {
    backgroundColor: '#2563eb',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  logoSection: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  logo: {
    width: 120,
    height: 70,
    marginBottom: 12,
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
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 16,
  },
  profileCard: {
    backgroundColor: '#ffffff',
    margin: 20,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f3f4f6',
  },
  avatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  statusBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10b981',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  userName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 6,
  },
  companyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  companyText: {
    fontSize: 12,
    color: '#2563eb',
    fontWeight: '500',
    marginLeft: 4,
  },
  editButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  userDetails: {
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  detailLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  detailValue: {
    fontSize: 14,
    color: '#1f2937',
    fontWeight: '500',
  },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dc2626',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  adminText: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: 'bold',
    marginLeft: 4,
  },
  menuSection: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1f2937',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  profileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  profileItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  profileItemContent: {
    flex: 1,
  },
  profileItemTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1f2937',
    marginBottom: 2,
  },
  profileItemSubtitle: {
    fontSize: 14,
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
  logoutSection: {
    marginHorizontal: 20,
    marginBottom: 30,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#dc2626',
    marginLeft: 8,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  footerText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2563eb',
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 8,
  },
  versionText: {
    fontSize: 12,
    color: '#9ca3af',
  },
});
