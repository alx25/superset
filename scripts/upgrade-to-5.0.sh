#!/bin/bash
# Script de Asistencia para Actualización a Superset 5.0
# Este script ayuda a automatizar el proceso de actualización

set -e  # Salir si hay algún error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para imprimir mensajes
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════${NC}\n"
}

# Verificar que estamos en el directorio correcto
if [ ! -f "setup.py" ] || [ ! -d "superset" ]; then
    print_error "Este script debe ejecutarse desde el directorio raíz de Superset"
    exit 1
fi

# Función para crear respaldo
create_backup() {
    print_header "Creando Respaldo"
    
    BACKUP_DATE=$(date +%Y%m%d-%H%M%S)
    BACKUP_DIR="../superset-backup-${BACKUP_DATE}"
    
    print_info "Creando respaldo en: ${BACKUP_DIR}"
    
    # Crear directorio de respaldo
    mkdir -p "${BACKUP_DIR}"
    
    # Copiar archivos importantes (excluyendo node_modules y otros pesados)
    rsync -av --exclude='node_modules' \
              --exclude='superset-frontend/node_modules' \
              --exclude='.git' \
              --exclude='__pycache__' \
              --exclude='*.pyc' \
              --exclude='.tox' \
              --exclude='.eggs' \
              --exclude='build' \
              --exclude='dist' \
              ./ "${BACKUP_DIR}/"
    
    print_success "Respaldo creado exitosamente en: ${BACKUP_DIR}"
    echo "${BACKUP_DIR}" > .last_backup_path
}

# Función para crear rama de backup
create_git_backup() {
    print_header "Creando Rama de Respaldo en Git"
    
    CURRENT_BRANCH=$(git branch --show-current)
    BACKUP_BRANCH="${CURRENT_BRANCH}-backup-$(date +%Y%m%d)"
    
    print_info "Rama actual: ${CURRENT_BRANCH}"
    print_info "Creando rama de backup: ${BACKUP_BRANCH}"
    
    git branch "${BACKUP_BRANCH}"
    git push origin "${BACKUP_BRANCH}" || print_warning "No se pudo hacer push de la rama de backup (tal vez no hay conexión)"
    
    print_success "Rama de backup creada: ${BACKUP_BRANCH}"
}

# Función para actualizar upstream
update_upstream() {
    print_header "Actualizando Referencias de Upstream"
    
    print_info "Verificando remote upstream..."
    
    if ! git remote | grep -q "upstream"; then
        print_warning "Remote 'upstream' no configurado"
        read -p "¿Deseas configurarlo ahora? (s/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Ss]$ ]]; then
            git remote add upstream https://github.com/apache/superset.git
            print_success "Remote upstream agregado"
        else
            print_error "No se puede continuar sin upstream configurado"
            exit 1
        fi
    fi
    
    print_info "Obteniendo últimos cambios de upstream..."
    git fetch upstream
    
    print_success "Referencias actualizadas"
}

# Función para crear rama de upgrade
create_upgrade_branch() {
    print_header "Creando Rama de Actualización"
    
    UPGRADE_BRANCH="dev-5.0-upgrade"
    
    print_info "Verificando que no exista la rama ${UPGRADE_BRANCH}..."
    
    if git show-ref --verify --quiet "refs/heads/${UPGRADE_BRANCH}"; then
        print_warning "La rama ${UPGRADE_BRANCH} ya existe"
        read -p "¿Deseas eliminarla y crear una nueva? (s/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Ss]$ ]]; then
            git branch -D "${UPGRADE_BRANCH}"
            print_info "Rama eliminada"
        else
            print_error "No se puede continuar con una rama existente"
            exit 1
        fi
    fi
    
    print_info "Creando rama ${UPGRADE_BRANCH}..."
    git checkout -b "${UPGRADE_BRANCH}"
    
    print_success "Rama ${UPGRADE_BRANCH} creada y activa"
}

# Función para intentar merge
attempt_merge() {
    print_header "Intentando Merge con Upstream 5.0"
    
    print_warning "Este paso puede generar conflictos que necesitarás resolver manualmente"
    read -p "¿Deseas continuar? (s/n): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        print_info "Merge cancelado"
        return 1
    fi
    
    print_info "Iniciando merge..."
    
    if git merge upstream/5.0 --no-ff -m "Merge upstream 5.0 into dev"; then
        print_success "¡Merge completado sin conflictos!"
        return 0
    else
        print_warning "Se detectaron conflictos que necesitan resolución manual"
        print_info "Archivos con conflictos:"
        git diff --name-only --diff-filter=U
        
        echo ""
        print_info "Para resolver:"
        echo "  1. Edita los archivos en conflicto"
        echo "  2. Ejecuta: git add <archivo>"
        echo "  3. Cuando termines: git merge --continue"
        echo ""
        print_info "Para abortar el merge: git merge --abort"
        
        return 1
    fi
}

# Función para verificar estado
check_status() {
    print_header "Verificando Estado del Repositorio"
    
    print_info "Rama actual: $(git branch --show-current)"
    print_info "Estado de git:"
    git status --short
    
    if git diff --quiet && git diff --cached --quiet; then
        print_success "Directorio de trabajo limpio"
        return 0
    else
        print_warning "Hay cambios sin commitear"
        return 1
    fi
}

# Función para verificar dependencias
check_dependencies() {
    print_header "Verificando Dependencias del Sistema"
    
    # Verificar Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_success "Node.js instalado: ${NODE_VERSION}"
    else
        print_error "Node.js no está instalado"
    fi
    
    # Verificar npm
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm --version)
        print_success "npm instalado: ${NPM_VERSION}"
    else
        print_error "npm no está instalado"
    fi
    
    # Verificar Python
    if command -v python3 &> /dev/null; then
        PYTHON_VERSION=$(python3 --version)
        print_success "Python instalado: ${PYTHON_VERSION}"
    else
        print_error "Python3 no está instalado"
    fi
    
    # Verificar pip
    if command -v pip3 &> /dev/null; then
        PIP_VERSION=$(pip3 --version)
        print_success "pip instalado: ${PIP_VERSION}"
    else
        print_error "pip3 no está instalado"
    fi
}

# Función para instalar dependencias del frontend
install_frontend_deps() {
    print_header "Instalando Dependencias del Frontend"
    
    if [ ! -d "superset-frontend" ]; then
        print_error "Directorio superset-frontend no encontrado"
        return 1
    fi
    
    cd superset-frontend
    
    print_info "Instalando dependencias con npm..."
    npm install
    
    print_success "Dependencias del frontend instaladas"
    cd ..
}

# Función para build del frontend
build_frontend() {
    print_header "Compilando Frontend"
    
    if [ ! -d "superset-frontend" ]; then
        print_error "Directorio superset-frontend no encontrado"
        return 1
    fi
    
    cd superset-frontend
    
    print_info "Ejecutando build..."
    npm run build
    
    if [ $? -eq 0 ]; then
        print_success "Frontend compilado exitosamente"
        cd ..
        return 0
    else
        print_error "Error al compilar el frontend"
        cd ..
        return 1
    fi
}

# Función para mostrar resumen
show_summary() {
    print_header "Resumen de Cambios"
    
    print_info "Cambios desde la rama base:"
    git log --oneline --no-merges superset-4.1.2-fork..HEAD | head -20
    
    echo ""
    print_info "Archivos modificados:"
    git diff --name-status superset-4.1.2-fork..HEAD | head -30
}

# Función para mostrar menú
show_menu() {
    clear
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════╗"
    echo "║   Asistente de Actualización Superset 5.0     ║"
    echo "╚════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    echo "Selecciona una opción:"
    echo ""
    echo "  1) Proceso Completo Automatizado (Recomendado)"
    echo "  2) Paso 1: Crear Respaldo"
    echo "  3) Paso 2: Crear Rama de Backup en Git"
    echo "  4) Paso 3: Actualizar Upstream"
    echo "  5) Paso 4: Crear Rama de Upgrade"
    echo "  6) Paso 5: Intentar Merge"
    echo "  7) Instalar Dependencias del Frontend"
    echo "  8) Compilar Frontend"
    echo "  9) Verificar Estado"
    echo " 10) Ver Resumen de Cambios"
    echo " 11) Verificar Dependencias del Sistema"
    echo ""
    echo "  0) Salir"
    echo ""
    read -p "Opción: " option
    echo ""
    return $option
}

# Función principal del proceso completo
full_process() {
    print_header "Iniciando Proceso Completo de Actualización"
    
    print_warning "Este proceso ejecutará todos los pasos automáticamente"
    print_warning "Se detendrá si encuentra conflictos o errores"
    echo ""
    read -p "¿Deseas continuar? (s/n): " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
        print_info "Proceso cancelado"
        return 1
    fi
    
    # Verificar estado inicial
    if ! check_status; then
        print_error "El directorio de trabajo debe estar limpio para continuar"
        return 1
    fi
    
    # Paso 1: Backup
    create_backup
    
    # Paso 2: Git backup
    create_git_backup
    
    # Paso 3: Update upstream
    update_upstream
    
    # Paso 4: Create upgrade branch
    create_upgrade_branch
    
    # Paso 5: Attempt merge
    if ! attempt_merge; then
        print_warning "El proceso se detuvo debido a conflictos"
        print_info "Resuelve los conflictos manualmente y luego:"
        print_info "  - Instala dependencias: Opción 7"
        print_info "  - Compila frontend: Opción 8"
        return 1
    fi
    
    # Paso 6: Install frontend dependencies
    if ! install_frontend_deps; then
        print_error "Error instalando dependencias"
        return 1
    fi
    
    # Paso 7: Build frontend
    if ! build_frontend; then
        print_error "Error compilando el frontend"
        return 1
    fi
    
    print_success "¡Proceso completo exitoso!"
    print_info "Siguiente paso: Probar la aplicación"
    print_info "Ejecuta: superset db upgrade && superset init && superset run -p 8088"
}

# Main loop
main() {
    while true; do
        show_menu
        option=$?
        
        case $option in
            1)
                full_process
                read -p "Presiona Enter para continuar..."
                ;;
            2)
                create_backup
                read -p "Presiona Enter para continuar..."
                ;;
            3)
                create_git_backup
                read -p "Presiona Enter para continuar..."
                ;;
            4)
                update_upstream
                read -p "Presiona Enter para continuar..."
                ;;
            5)
                create_upgrade_branch
                read -p "Presiona Enter para continuar..."
                ;;
            6)
                attempt_merge
                read -p "Presiona Enter para continuar..."
                ;;
            7)
                install_frontend_deps
                read -p "Presiona Enter para continuar..."
                ;;
            8)
                build_frontend
                read -p "Presiona Enter para continuar..."
                ;;
            9)
                check_status
                read -p "Presiona Enter para continuar..."
                ;;
            10)
                show_summary
                read -p "Presiona Enter para continuar..."
                ;;
            11)
                check_dependencies
                read -p "Presiona Enter para continuar..."
                ;;
            0)
                print_info "Saliendo..."
                exit 0
                ;;
            *)
                print_error "Opción inválida"
                read -p "Presiona Enter para continuar..."
                ;;
        esac
    done
}

# Ejecutar main
main
