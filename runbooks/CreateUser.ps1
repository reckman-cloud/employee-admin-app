Param(
     [parameter (Mandatory=$true)]
     [String]$entryId,
     [parameter (Mandatory=$true)]
     [String]$firstName,
     [parameter (Mandatory=$true)]
     [String]$lastName,
     [parameter (Mandatory=$true)]
     [String]$title,
     [parameter (Mandatory=$true)]
     [String]$department,
     [parameter (Mandatory=$true)]
     [String]$managerupn,
     [parameter (Mandatory=$true)]
     [String]$businessUnit,
     [parameter (Mandatory=$true)]
     [String]$startDate
)

function Set-EntryStatus {
    param($EntryId, $Status, $StageName, $StageNumber, $TotalStages, $StatusMessage)
    $url = Get-AutomationVariable -Name 'StatusUpdate-Url'
    $key = Get-AutomationVariable -Name 'StatusUpdate-Key'
    $body = @{ id=$EntryId; status=$Status; stageName=$StageName;
               stageNumber=$StageNumber; totalStages=$TotalStages;
               statusMessage=$StatusMessage } | ConvertTo-Json
    try {
        $null = Invoke-RestMethod -Uri $url -Method Post -Body $body `
            -Headers @{ "Content-Type"="application/json"; "x-update-key"=$key }
    } catch { Write-Warning "Status update failed: $_" }
}
try {


Set-EntryStatus $entryId "stage_create_user" "Creating AD Account" 1 3 $null


$password = $startDate

$BUgroups = @("sso_paycom_stok", "sso_paycom_sda", "sso_paycom_sklp", "sso_paycom_rc")
switch ($businessUnit) {
    'STOK' {$bugroup = $BUgroups[0]}
    'SDA'  {$bugroup = $BUgroups[1]}
    'SKLP' {$bugroup = $BUgroups[2]}
    'SRCBC' {$bugroup = $BUgroups[3]}
}

$address = $null
$City = $null
$BU = $null
$shortname = ($firstName.Substring(0,1) + $lastName).ToLower()

if ($department -eq "Rivercats") {
    #Write "Run rivercats command here"
                                    $upn = ($shortname + "@rivercats.com")
                                    $location = 'r'
    } else {
if ($department -like "Stockton*") {
                                    $upn = ($shortname + "@stocktonkings.com")
                                    $location = 's'}
    else {
            $upn = ($shortname + "@kings.com")
            
            if ($department -like "Arena*" -Or $department -like "AV" -Or $department -like "Technology*") {
                $location = 'a'}
                else { $location = 'h'}
             if ($department -like "Basketball*") {}
        }
}
$upn=$upn.ToLower()

Add-PsSnapin *RecipientManagement

$newuser = New-RemoteMailbox -Name "$firstName $lastName" -FirstName $firstName -LastName $lastName -UserPrincipalName $upn -OnPremisesOrganizationalUnit "OU=Users,OU=$department,OU=Team Members,DC=KINGSHQ,DC=COM" -Password (ConvertTo-SecureString -String $password -AsPlainText -Force) -Archive -PrimarySmtpAddress $upn
#New-RemoteMailbox -Name "Test face" -FirstName "Test" -LastName "Face" -UserPrincipalName "tface@kings.com" -OnPremisesOrganizationalUnit "OU=Users,OU=Analytics,OU=Team Members,DC=KINGSHQ,DC=COM" -Password (ConvertTo-SecureString -String "Oct15,2025" -AsPlainText -Force) -Archive -PrimarySmtpAddress "tface@kings.com"
Set-EntryStatus $entryId "stage_create_user" "AD Sync Pending" 1 3 $null


Start-Sleep 60

switch ($location) {
    'r' { $address = "400 Ballpark Drive"
            $City = "West Sacramento"
            $zip = "95691" }
    'a' { $address = "500 David J Stern Walk"
            $City = "Sacramento" 
            $zip = "95814" }
    'h' { $address = "500 J Street, 4th Floor" 
            $City = "Sacramento" 
            $zip = "95814" }
    's' { $address = "400 Main Street" 
            $City = "Stockton" 
            $zip = "95202" }
}


Set-aduser -Identity $shortname -Description $title -Title $title -Department $department -StreetAddress $address -City $City -PostalCode $zip -State CA -Country US -Company "Sacramento Kings" -add @{extensionattribute2="$firstName.$lastName"} -EmailAddress $upn

$managerSAM = $managerupn.Substring(0, $managerupn.indexof('@'))

try {
    Set-ADuser -Identity $shortname -Manager (Get-ADUser -Filter {Name -Like $managerSAM -Or SamAccountName -Like $managerSAM}).samaccountname
} catch {
    Write-Host "Bad manager name; Input Later"
}



switch ($department) {
    'Technology Operations' {$wifi = "wifi-techops"}
    'Analytics' {$wifi = "wifi-analytics"}
    'Arena Operations' { $wifi = "wifi-arenaops"}
    'AV' { $wifi = "wifi-av"}
    'Basketball Operations' { $wifi = "wifi-bbops"}
    'Box Office' { $wifi = "wifi-bo"}
    'Community' { $wifi = "wifi-community"}
    'Creative' { $wifi = "wifi-creative"}
    'Digital' { $wifi = "wifi-digital"}
    'Executive' { $wifi = "wifi-executives"}
    'Finance' { $wifi = "wifi-finance"}
    'Human Resources' { $wifi = "wifi-hr"}
    'Marketing' { $wifi = "wifi-marketing"}
    'Public Relations' { $wifi = "wifi-pr"}
    'Entertainment' { $wifi = "wifi-events"}
    'Partnerships' { $wifi = "wifi-sales"}
    'Sales' { $wifi = "wifi-sales"}
    'Suites-Lofts' { $wifi = "wifi-sales"}
    'Ticket Operations' { $wifi = "wifi-sales"}
    'Interns' { $wifi = "wifi-interns"}
    default { $wifi = "wifi-community"}
}

if ($department -eq "Rivercats") {
    $Groups = @("_allusers","2FA","intune") 
  } else {     
    $Groups = @("_allusers","2FA","intune","sso_alertmedia","sso_outreach","sso_salesforce","sso_workday","sso_asana","sso_envoy", $wifi)
    if ($department -eq 'Basketball Operations') {
        $Groups += ,@("sso_slack")
    }
}
$Groups += ,@($bugroup)


Foreach ($group in $Groups) {
    Add-ADPrincipalGroupMembership $shortname -MemberOf $group
}


$s = New-PSSession -ComputerName adconnect02.kingshq.com
$result = Invoke-Command -Session $s {Start-ADSyncSyncCycle -PolicyType delta}
Remove-PSsession $s

Set-EntryStatus $entryId "stage_cloud_provisioning" "Waiting for Cloud Sync" 2 3 $null

#[OutputType([string])]
Write-Output $upn
} catch {
    Set-EntryStatus $entryId "failed" "Create AD Account" 1 3 $_.Exception.Message
}
