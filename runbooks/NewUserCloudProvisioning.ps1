Param(
     [parameter (Mandatory=$true)]
     [String]$entryId,
     [parameter (Mandatory=$true)]
     [String]$data,
     [parameter (Mandatory=$true)]
     [Boolean]$fulltime,
     [parameter (Mandatory=$true)]
     [String]$department
)

#Write-Out $data
function Set-EntryStatus {
    param($EntryId, $Status, $StageName, $StageNumber, $TotalStages, $StatusMessage)
    $url = Get-AutomationVariable -Name 'StatusUpdate-Url'
    $key = Get-AutomationVariable -Name 'StatusUpdate-Key'
    $body = @{ id=$EntryId; status=$Status; stageName=$StageName;
               stageNumber=$StageNumber; totalStages=$TotalStages;
               statusMessage=$StatusMessage } | ConvertTo-Json
    try {
        Invoke-RestMethod -Uri $url -Method Post -Body $body `
            -Headers @{ "Content-Type"="application/json"; "x-update-key"=$key }
    } catch { Write-Warning "Status update failed: $_" }
}

$kingsnetworkid = Get-AutomationVariable -Name 'Graph-KingsNetworkGroupId'
$appid = Get-AutomationVariable -Name 'Graph-ClientId'
$secret = Get-AutomationVariable -Name 'Graph-ClientSecret'
$tenantId = Get-AutomationVariable -Name 'AzureAD-TenantId'
$secretid = ConvertTo-SecureString $secret -AsPlainText -Force
$clientsecretcred = New-Object -TypeName System.Management.Automation.PSCredential -Argumentlist $appid,$secretid

$dataarr = $data -split '@'
if ($dataarr[0].length -ne 0 -and $dataarr[1].length -ne 0) {

    Set-EntryStatus $entryId "stage_cloud_provisioning" "Assigning Licenses" 2 3 $null
    try {
    Connect-MgGraph -ClientSecretCredential $clientsecretcred -TenantId $tenantId
    $e5Sku = Get-MgSubscribedSku -All | Where SkuPartNumber -eq 'SPE_E5'
    $vivaSku = Get-MgSubscribedSku -All | Where SkuPartNumber -eq 'Viva_Connection_Mini_Bundle'

    $sig_groupid = (Get-MgGroup -All | Where {$_.DisplayName -eq $sig_group}).Id

    $userid = (Get-MgUser -UserId $data).Id
    Update-MgUser -UserId $data -UsageLocation US

    $retries = 5
     do {
         Start-Sleep -Seconds 3
         $userLocation = (Get-MgUser -UserId $data -Property UsageLocation).UsageLocation
         $retries--
     } until ($userLocation -eq "US" -or $retries -eq 0)

     if ($userLocation -ne "US") {
         throw "Usage location did not propagate for $data after multiple retries"
     }
    
    if ($fulltime -and $department -ne "Rivercats") {
        
        $body = @{
        addLicenses = @(
            @{skuId = $e5Sku.SkuId},
            @{skuId = $vivaSku.SkuId}
        )
        removeLicenses = @()
        }
        #Set-MgUserLicense -UserId $data -AddLicenses $addLicenses -RemoveLicenses @()

        New-MgGroupMember -GroupId $kingsnetworkid -DirectoryObjectId $userid
    #    New-MgGroupMember -GroupId $sig_groupid -DirectoryObjectId $userid

   
        
    } else {
        #Set-MgUserLicense -UserId $data -AddLicenses @{SkuId = $e5Sku.SkuId} -RemoveLicenses @()
        $body = @{
        addLicenses = @(
             @{skuId = $e5sku.SkuId}
        )
        removeLicenses = @()
        }
    }

     Invoke-MgGraphRequest -Method POST `
    -Uri "https://graph.microsoft.com/v1.0/users/$data/assignLicense" `
    -Body ($body | ConvertTo-Json -Depth 5) `
    -ContentType "application/json"
    
    Set-EntryStatus $entryId "stage_exchange_tasks" "Waiting for Exchange" 3 3 $null
    Disconnect-MgGraph
    } catch {
        Set-EntryStatus $entryId "failed" "Cloud Provisioning" 2 3 $_.Exception.Message
        Write-output "$_.Exception.Message"
    }
}
