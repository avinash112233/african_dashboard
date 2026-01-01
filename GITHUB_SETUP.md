# GitHub Repository Setup Guide

Follow these steps to set up and push your african_dashboard project to GitHub.

## Step 1: Initialize Git (if not already done)

```bash
cd "/Users/avinashtelagamsetti/Desktop/MY_PC/AQF PRoject/african_dashboard"

# Remove the existing .git folder if it's corrupted
rm -rf .git

# Initialize git
git init
```

## Step 2: Check .gitignore

Make sure your `.gitignore` file excludes:
- `node_modules/`
- `dist/`
- `.env` files
- `*.md` (if you want to exclude the large cursor_another_project_assistance.md file)

If you want to exclude the large chat file, add it to .gitignore:
```bash
echo "cursor_another_project_assistance.md" >> .gitignore
```

## Step 3: Stage and Commit Files

```bash
# Stage all files
git add .

# Check what will be committed
git status

# Make initial commit
git commit -m "Initial commit: African Aerosol Dashboard project"
```

## Step 4: Create GitHub Repository

1. Go to https://github.com
2. Click the "+" icon in the top right
3. Select "New repository"
4. Repository name: `african_dashboard` (or your preferred name)
5. Description: "African Aerosol Dashboard - Comprehensive aerosol monitoring and data visualization platform for Africa"
6. Choose Public or Private
7. DO NOT initialize with README, .gitignore, or license (we already have these)
8. Click "Create repository"

## Step 5: Connect Local Repository to GitHub

After creating the repo, GitHub will show you commands. Use these:

```bash
# Add the remote repository (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/african_dashboard.git

# Or if using SSH:
# git remote add origin git@github.com:YOUR_USERNAME/african_dashboard.git

# Verify the remote was added
git remote -v
```

## Step 6: Push to GitHub

```bash
# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

If you get authentication errors, you may need to:
- Use a Personal Access Token instead of password
- Set up SSH keys
- Use GitHub CLI

## Step 7: Verify

Go to your GitHub repository page and verify all files are there:
https://github.com/YOUR_USERNAME/african_dashboard

## Troubleshooting

### If you need to exclude the large chat file:
```bash
echo "cursor_another_project_assistance.md" >> .gitignore
git rm --cached cursor_another_project_assistance.md
git commit -m "Remove large chat file from tracking"
```

### If you need to update the remote URL:
```bash
git remote set-url origin https://github.com/YOUR_USERNAME/african_dashboard.git
```

### If you get "branch 'main' has no upstream branch":
```bash
git push --set-upstream origin main
```

